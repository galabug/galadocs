"""盘后复盘采集器。Python 3.9+，默认免费免账号多源；Tushare 为可选来源。"""
import argparse
from contextlib import contextmanager
from datetime import date, datetime, timedelta
import fcntl
import json
import math
import os
from pathlib import Path
import random
import sqlite3
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
ZONE = ZoneInfo('Asia/Shanghai')
VERSION = 1


def main_board(code):
    return (code.endswith('.SH') and code[:3] in ('600', '601', '603', '605')) or (
        code.endswith('.SZ') and code[:3] in ('000', '001', '002', '003'))


def eligible(row, st_codes):
    name = row.get('name', '').upper().replace(' ', '')
    return main_board(row['ts_code']) and row['ts_code'] not in st_codes and 'ST' not in name and '退' not in name


def summarize(day, previous, current):
    """昨日股票池固定；今日 ST、停牌/缺行情样本剔除，并单独报告数量。"""
    excluded = set(current['st'])
    up = [r for r in current['up'] if eligible(r, excluded)]
    down = [r for r in current['down'] if eligible(r, excluded)]
    previous_up = [r for r in previous['up'] if eligible(r, set(previous['st']))]
    consecutive = [r for r in up if int(r['limit_times']) >= 2]
    quotes = {r['ts_code']: r for r in current['daily']}

    def premium(pool):
        values = []
        for stock in pool:
            quote = quotes.get(stock['ts_code'])
            if stock['ts_code'] in excluded or quote is None:
                continue
            close, prior = quote.get('close'), quote.get('pre_close')
            if close is None or prior is None or not math.isfinite(float(close)) or not math.isfinite(float(prior)) or prior <= 0:
                raise ValueError(f'{day}: 非法价格，停止发布')
            values.append((close / prior - 1) * 100)
        return (round(sum(values) / len(values), 4) if values else None,
                len(values), len(pool) - len(values))

    up_premium, up_samples, up_excluded = premium(previous_up)
    streak_premium, streak_samples, streak_excluded = premium(
        [r for r in previous_up if int(r['limit_times']) >= 2])
    heights = [int(r['limit_times']) for r in consecutive]
    return {
        'date': date.fromisoformat(day).isoformat(),
        'limitUp': len(up), 'limitDown': len(down), 'consecutive': len(consecutive),
        'upPremium': up_premium, 'consecutivePremium': streak_premium,
        'highest': max(heights) if heights else None,
        'lowest': min(heights) if heights else None,
        'upSamples': up_samples, 'consecutiveSamples': streak_samples,
        'upExcluded': up_excluded, 'consecutiveExcluded': streak_excluded,
        'poolSource': current.get('poolSource', 'tushare'),
        'quoteSource': current.get('quoteSource', 'tushare'),
        'method': current.get('method', '数据源收盘涨跌停池'),
    }


class Tushare:
    def __init__(self, token):
        self.token = token

    def query(self, api, fields, cap, **params):
        # 达到接口上限即停止，避免把截断数据发布为完整统计。
        body = json.dumps({'api_name': api, 'token': self.token,
                           'params': params, 'fields': fields}).encode()
        for attempt in range(3):
            try:
                request = Request('https://api.tushare.pro', data=body,
                                  headers={'Content-Type': 'application/json'})
                with urlopen(request, timeout=30) as response:
                    result = json.load(response)
                if result.get('code') != 0:
                    # 不输出响应全文，防止服务端错误信息回显凭证。
                    raise RuntimeError(f'{api} 请求失败，代码 {result.get("code")}；请检查权限或限流')
                data = result.get('data')
                if not data or not isinstance(data.get('items'), list):
                    raise RuntimeError(f'{api} 返回格式异常')
                rows = [dict(zip(data['fields'], item)) for item in data['items']]
                if len(rows) >= cap:
                    raise RuntimeError(f'{api} 触及 {cap} 条上限，请拆分查询后重跑')
                expected = params.get('trade_date')
                if expected and any(r.get('trade_date') != expected for r in rows):
                    raise RuntimeError(f'{api} 返回了错误日期的数据')
                time.sleep(0.35)
                return rows
            except (URLError, TimeoutError):
                if attempt == 2:
                    raise RuntimeError(f'{api} 网络请求失败，已重试 3 次') from None
                time.sleep(2 ** attempt)
        raise RuntimeError('请求失败')

    def calendar(self, start, end):
        rows = self.query('trade_cal', 'cal_date,is_open', 10000,
                          exchange='SSE', start_date=start.strftime('%Y%m%d'),
                          end_date=end.strftime('%Y%m%d'), is_open='1')
        return sorted({datetime.strptime(r['cal_date'], '%Y%m%d').date()
                       for r in rows if int(r['is_open']) == 1})

    def snapshot(self, day):
        key = day.strftime('%Y%m%d')
        st = self.query('stock_st', 'ts_code,trade_date', 1000, trade_date=key)
        if not st:
            raise RuntimeError(f'{key}: ST 列表为空，无法确认历史股票范围，停止发布')
        excluded = {r['ts_code'] for r in st}
        pools = {}
        for name, kind in [('up', 'U'), ('down', 'D')]:
            rows = []
            for exchange in ('SH', 'SZ'):
                rows.extend(self.query('limit_list_d', 'ts_code,trade_date,name,limit_times',
                                       2500, trade_date=key, limit_type=kind, exchange=exchange))
            pools[name] = [r for r in rows if eligible(r, excluded)]
            if len({r['ts_code'] for r in rows}) != len(rows):
                raise RuntimeError(f'{key}: 涨跌停池存在重复股票')
        if not pools['up'] and not pools['down']:
            raise RuntimeError(f'{key}: 涨跌停池同时为空，请确认数据已更新后重跑')
        daily = self.query('daily', 'ts_code,trade_date,close,pre_close', 6000, trade_date=key)
        if len(daily) < 1000 or len({r['ts_code'] for r in daily}) != len(daily):
            raise RuntimeError(f'{key}: 日行情可能未更新完整，停止发布')
        available = {r['ts_code'] for r in daily}
        if any(r['ts_code'] not in available for r in pools['up'] + pools['down']):
            raise RuntimeError(f'{key}: 涨跌停股票缺少日行情，停止发布')
        # 只持久化主板非 ST 行情，原始接口会返回全市场。
        return {**pools, 'st': sorted(excluded),
                'daily': [r for r in daily if main_board(r['ts_code']) and r['ts_code'] not in excluded],
                'poolSource': 'tushare', 'quoteSource': 'tushare'}


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(payload, output, ensure_ascii=False, allow_nan=False, indent=2)
            output.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_health(path, report):
    # 采集只会检查实际使用的来源，保留其他源较新的主动诊断结果。
    existing = {}
    if path.exists():
        try:
            previous = json.loads(path.read_text(encoding='utf-8'))
            existing = {r['id']: r for r in previous.get('sources', []) if isinstance(r, dict) and 'id' in r}
        except (ValueError, OSError):
            pass
    merged = []
    for row in report['sources']:
        old = existing.get(row['id'])
        if old and (old.get('checkedAt') or '') > (row.get('checkedAt') or ''):
            merged.append(old)
        else:
            merged.append(row)
    write_json(path, {**report, 'sources': merged})


def envelope(rows, source):
    return {'schemaVersion': VERSION, 'source': source,
            'generatedAt': datetime.now(ZONE).strftime('%Y-%m-%d %H:%M:%S'), 'rows': rows}


def demo_rows():
    # 固定示意日期，不声称使用真实交易日历或真实行情。
    rng = random.Random(26)
    days, cursor = [], date(2026, 9, 24)
    while len(days) < 40:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor -= timedelta(days=1)
    rows = []
    for i, day in enumerate(reversed(days)):
        wave = math.sin(i / 4) * 19 + math.sin(i / 1.7) * 9
        up = max(12, round(48 + wave + rng.randint(-9, 9)))
        down = max(2, round(15 - wave / 3 + rng.randint(-5, 6)))
        consecutive = max(2, round(up * (0.20 + rng.random() * 0.1)))
        prior = rows[-1] if rows else {'limitUp': 42, 'consecutive': 10}
        rows.append({'date': day.isoformat(), 'limitUp': up, 'limitDown': down,
                     'consecutive': consecutive,
                     'upPremium': round(1.1 + wave / 9 + rng.uniform(-1.3, 1.3), 2),
                     'consecutivePremium': round(1.5 + wave / 7 + rng.uniform(-1.5, 1.5), 2),
                     'highest': max(3, round(6 + wave / 9)), 'lowest': 2,
                     'upSamples': prior['limitUp'], 'consecutiveSamples': prior['consecutive'],
                     'upExcluded': 0, 'consecutiveExcluded': 0})
    return rows


@contextmanager
def process_lock(database):
    database.parent.mkdir(parents=True, exist_ok=True)
    with database.with_suffix('.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('已有采集任务运行，本次退出') from None
        yield


def collect(provider, connection, end, days=40, refresh=3, allow_pending_latest=False):
    connection.execute('CREATE TABLE IF NOT EXISTS snapshots (date TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS metrics (date TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    first = connection.execute('SELECT MIN(date) FROM metrics').fetchone()[0]
    start = date.fromisoformat(first) - timedelta(days=30) if first else end - timedelta(days=max(180, days * 3))
    calendar = provider.calendar(start, end)
    if len(calendar) < days + 1 and not first:
        raise RuntimeError('交易日历不足，无法生成完整初始窗口')
    targets = [d for d in calendar if d.isoformat() >= first] if first else calendar[-days:]
    if not targets:
        raise RuntimeError('没有可采集的交易日')
    existing = {r[0] for r in connection.execute('SELECT date FROM metrics')}
    recent = set(targets[-refresh:]) if refresh else set()
    snapshot_recent = set(recent)
    if recent:
        first_recent = calendar.index(min(recent))
        if first_recent > 0:
            snapshot_recent.add(calendar[first_recent - 1])
    cache = {}

    def snapshot(day):
        key = day.isoformat()
        if key not in cache:
            saved = connection.execute('SELECT payload FROM snapshots WHERE date=?', (key,)).fetchone()
            if saved and day not in snapshot_recent:
                cache[key] = json.loads(saved[0])
            else:
                cache[key] = provider.snapshot(day)
                connection.execute('INSERT OR REPLACE INTO snapshots VALUES (?, ?)',
                                   (key, json.dumps(cache[key], allow_nan=False)))
        return cache[key]

    # 一个完整批次原子提交；网络错误不会留下半批统计。
    with connection:
        if not connection.in_transaction:
            connection.execute('BEGIN')
        for day in targets:
            if day.isoformat() in existing and day not in recent:
                continue
            index = calendar.index(day)
            if index == 0:
                raise RuntimeError('缺少前一交易日，无法计算溢价')
            connection.execute('SAVEPOINT current_day')
            try:
                result = summarize(day.isoformat(), snapshot(calendar[index - 1]), snapshot(day))
            except (RuntimeError, ValueError) as error:
                connection.execute('ROLLBACK TO current_day')
                connection.execute('RELEASE current_day')
                if (allow_pending_latest and day == end and day.isoformat() not in existing
                        and connection.execute('SELECT COUNT(*) FROM metrics').fetchone()[0] > 0):
                    provider.pending_day = {'date': day.isoformat(), 'reason': str(error)}
                    print(f'{day}: 当日数据未通过完整性检查，保留已补齐历史，下次继续补采：{error}', flush=True)
                    break
                raise
            connection.execute('RELEASE current_day')
            connection.execute('INSERT OR REPLACE INTO metrics VALUES (?, ?)',
                               (day.isoformat(), json.dumps(result, allow_nan=False)))
            print(f'{day}: 涨停 {result["limitUp"]} / 跌停 {result["limitDown"]} / 连板 {result["consecutive"]}', flush=True)
    return [json.loads(r[0]) for r in connection.execute('SELECT payload FROM metrics ORDER BY date')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', action='store_true', help='生成固定 40 日示例，不请求网络')
    parser.add_argument('--end', type=date.fromisoformat, help='结束日期 YYYY-MM-DD；默认上海时间最近已收盘日')
    parser.add_argument('--days', type=int, default=40, help='首次采集窗口，默认 40')
    parser.add_argument('--refresh', type=int, default=3, help='重算最近 N 日以接收数据修订')
    parser.add_argument('--output', type=Path, help='JSON 输出路径')
    parser.add_argument('--database', type=Path, help='默认免费源和 Tushare 分库保存')
    parser.add_argument('--source', choices=['auto', 'baostock', 'eastmoney', 'tushare'], default='auto', help='默认免费自动主备；Tushare 仅在显式选择时使用')
    parser.add_argument('--check-sources', action='store_true', help='检测四个免费来源并输出页面状态文件')
    args = parser.parse_args()
    if args.days < 1 or args.refresh < 0:
        parser.error('days 必须为正数，refresh 不得为负数')
    if args.demo:
        output = args.output or ROOT / 'public/data/review-demo.json'
        write_json(output, envelope(demo_rows(), 'demo'))
        print(f'已生成 40 日模拟数据：{output}')
        return
    now = datetime.now(ZONE)
    # 免费源 18:00 后尝试当日数据；延迟入库时保存已补齐历史并标记待补。
    cutoff = 16 if args.source == 'tushare' else 18
    latest = now.date() - timedelta(days=1) if now.hour < cutoff else now.date()
    end = args.end or latest
    if end > latest:
        parser.error('不能采集尚未收盘或未到默认数据入库时间的日期')
    source = 'tushare' if args.source == 'tushare' else 'free'
    output = args.output or ROOT / 'public/data/review.json'
    database = args.database or ROOT / f'data/market-review-{source}.sqlite3'
    if args.source == 'tushare':
        token = os.environ.get('TUSHARE_TOKEN')
        if not token:
            parser.error('仅 --source tushare 需要 TUSHARE_TOKEN；直接运行使用免费数据源')
        provider = Tushare(token)
    else:
        from free_sources import FreeSources
        provider = FreeSources(ROOT / 'public/a', end, args.source)
        provider.providers['baostock'].refresh_days = args.refresh
    with process_lock(database):
        try:
            if args.check_sources:
                if source == 'tushare':
                    parser.error('--check-sources 用于免费来源，请移除 --source tushare')
                calendar = provider.calendar(end - timedelta(days=180), end)
                provider.end = calendar[-1]
                provider.providers['baostock'].end = calendar[-1]
                provider.check()
                return
            with sqlite3.connect(database) as connection:
                rows = collect(provider, connection, end, args.days, args.refresh,
                               allow_pending_latest=source == 'free' and end == now.date())
            payload = envelope(rows, source)
            if source == 'free':
                payload['sourceName'] = '免费多源 · BaoStock / 东方财富'
                payload['calendarSource'] = provider.calendar_source
                payload['sources'] = list(provider.health.items.values())
                payload['notice'] = '主板按10%价格规则推算封板，排除注册制IPO前5日；特殊重新上市日需核对。备用股池口径可能不同，逐日保留来源。'
                if getattr(provider, 'pending_day', None):
                    payload['pendingDay'] = provider.pending_day
                    payload['notice'] += f' {provider.pending_day["date"]} 数据尚未可用，已保存此前补齐的交易日，下次运行继续补采。'
            write_json(output, payload)
        finally:
            if source == 'free':
                provider.providers['baostock'].close()
                publish_health(ROOT / 'public/data/sources.json', provider.health.export())
    print(f'已发布 {len(rows)} 个交易日：{output}')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, sqlite3.Error) as error:
        raise SystemExit(f'采集失败：{error}') from None
