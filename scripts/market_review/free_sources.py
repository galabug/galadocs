"""Free public providers with explicit capability boundaries and cached provenance."""
from bisect import bisect_right
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import json
import math
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Shanghai')
SOURCE_INFO = {
    'baostock': ('BaoStock', '完整历史复盘：历史 ST、除权昨收、日行情；按主板价格规则计算封板'),
    'eastmoney': ('东方财富', '近期涨跌停股池及昨日涨停表现；历史窗口有限，不保证 40 日初始化'),
    'tencent': ('腾讯证券', '交易日和个股历史行情备用；不能独立提供历史 ST 和完整涨跌停池'),
    'sina': ('新浪财经', '交易日和个股历史行情校验备用；不能独立提供历史 ST 和完整涨跌停池'),
}


def normalize_code(code):
    code = code.lower()
    if code.startswith(('sh.', 'sz.')):
        return code[3:] + '.' + code[:2].upper()
    if code.startswith(('sh', 'sz')):
        return code[2:] + '.' + code[:2].upper()
    if '.' in code:
        return code.upper()
    return code + ('.SH' if code.startswith('6') else '.SZ')


def main_board(code):
    return (code.endswith('.SH') and code[:3] in ('600', '601', '603', '605')) or (
        code.endswith('.SZ') and code[:3] in ('000', '001', '002', '003'))


def decimal_price(value):
    result = Decimal(str(value))
    if not result.is_finite() or result <= 0:
        raise RuntimeError('行情包含非法价格')
    return result


def band_direction(row, ipo_date, calendar):
    """Modern main-board 10% band, half-up to one cent; never use pctChg >= 9.9."""
    if row.get('isST') not in ('0', '1') or row.get('tradestatus') not in ('0', '1'):
        raise RuntimeError('缺少历史 ST / 停牌状态，不能推算涨跌停')
    if row['isST'] == '1' or row['tradestatus'] == '0':
        return None
    day = date.fromisoformat(row['date'])
    listed = date.fromisoformat(ipo_date)
    # 注册制主板 IPO 前 5 个交易日不设涨跌幅限制；旧制首日另行排除。
    no_band_days = 5 if listed >= date(2023, 4, 10) else 1
    if listed >= calendar[0] and bisect_right(calendar, day) - bisect_right(calendar, listed - timedelta(days=1)) <= no_band_days:
        return None
    close = decimal_price(row['close'])
    prior = decimal_price(row['preclose'])
    upper = (prior * Decimal('1.1')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    lower = (prior * Decimal('0.9')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    # 低价股不足一个最小报价单位时，至少增减 0.01 元。
    upper = max(upper, prior + Decimal('0.01'))
    lower = min(lower, prior - Decimal('0.01'))
    if close == upper and close > prior:
        return 'up'
    if close == lower and close < prior:
        return 'down'
    return None


class PublicHTTP:
    def __init__(self, timeout=12, pause=0.3):
        self.timeout, self.pause = timeout, pause

    def json(self, url, params=None):
        request = Request(url + ('?' + urlencode(params) if params else ''), headers={
            'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
            'Referer': url.split('/api/')[0],
        })
        for attempt in range(2):
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    text = response.read().decode('utf-8')
                time.sleep(self.pause)
                return json.loads(text)
            except (URLError, TimeoutError, socket.timeout, ConnectionError, json.JSONDecodeError, UnicodeError) as error:
                if attempt == 1:
                    raise RuntimeError(f'公开接口连接或格式异常 ({type(error).__name__})') from None
                time.sleep(0.5)
        raise RuntimeError('请求失败')


class Health:
    def __init__(self):
        self.items = {key: {'id': key, 'name': label, 'capability': capability,
                            'status': 'untested', 'detail': '本次尚未检查', 'checkedAt': None}
                      for key, (label, capability) in SOURCE_INFO.items()}

    def mark(self, key, ok, detail):
        self.items[key].update(status='ok' if ok else 'unavailable', detail=detail,
                               checkedAt=datetime.now(ZONE).isoformat())

    def export(self):
        return {'checkedAt': datetime.now(ZONE).isoformat(), 'sources': list(self.items.values())}


class BaoStockSource:
    name = 'baostock'

    def __init__(self, cache_dir, end, timeout=45):
        self.cache_dir, self.end, self.timeout = Path(cache_dir), end, timeout
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.calendar_days = []
        self.basics = None
        self.raw_memory = {}
        self.classified = {}
        self.refresh_days = 3
        self.refresh_dates = {end}
        self.worker = None
        self.buffer = b''

    def close(self):
        if self.worker is not None:
            process = self.worker
            self.worker = None
            process.stdin.close()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            process.stdout.close()
            self.buffer = b''

    def request(self, operation, **params):
        for attempt in range(3):
            try:
                return self.request_once(operation, **params)
            except (RuntimeError, OSError) as error:
                if attempt == 2:
                    raise
                print(f'BaoStock 连接重试 {attempt + 1}/2：{error}', flush=True)
                time.sleep(2 * (attempt + 1))

    def request_once(self, operation, **params):
        if self.worker is None:
            environment = {key: value for key, value in os.environ.items() if key not in ('BAOSTOCK_API_KEY', 'API_KEY')}
            self.worker = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('baostock_worker.py')), '--serve'],
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment)
        try:
            message = json.dumps({'operation': operation, 'params': params}).encode() + b'\n'
            self.worker.stdin.write(message)
            self.worker.stdin.flush()
            deadline = time.monotonic() + self.timeout
            while b'\n' not in self.buffer:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([self.worker.stdout], [], [], remaining)[0]:
                    raise RuntimeError('BaoStock 请求超时，已终止工作进程')
                chunk = os.read(self.worker.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError('BaoStock 工作进程已退出')
                self.buffer += chunk
                if len(self.buffer) > 30_000_000:
                    raise RuntimeError('BaoStock 响应超出预期大小')
            line, self.buffer = self.buffer.split(b'\n', 1)
            result = json.loads(line)
            if 'error' in result:
                raise RuntimeError(result['error'])
            time.sleep(0.3)
            return result['rows']
        except (RuntimeError, OSError, ValueError, KeyError):
            self.close()
            raise

    def calendar(self, start, end):
        # 更早日历用于 IPO 排除及跨展示窗口的连板追溯。
        begin = min(start, end - timedelta(days=400))
        rows = self.request('calendar', start_date=begin.isoformat(), end_date=end.isoformat())
        self.calendar_days = sorted({date.fromisoformat(r['calendar_date']) for r in rows
                                     if r['is_trading_day'] == '1'})
        if not self.calendar_days or self.calendar_days[-1] < end - timedelta(days=15):
            raise RuntimeError('BaoStock 交易日历为空或过期')
        self.refresh_dates = set(self.calendar_days[-(self.refresh_days + 1):])
        return [d for d in self.calendar_days if start <= d <= end]

    def basic(self):
        if self.basics is None:
            rows = self.request('basic')
            self.basics = {normalize_code(r['code']): r for r in rows
                           if r['type'] == '1' and main_board(normalize_code(r['code']))}
            if len(self.basics) < 2500:
                raise RuntimeError('BaoStock 主板证券基础资料不完整')
        return self.basics

    def raw(self, day):
        key = day.isoformat()
        if key in self.raw_memory:
            return self.raw_memory[key]
        path = self.cache_dir / key / 'baostock.json'
        rows = None
        if path.exists() and day not in self.refresh_dates:
            try:
                rows = json.loads(path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                pass
        if rows is None:
            print(f'下载 BaoStock 主板日行情：{key}', flush=True)
            rows = self.request('daily', date=key)
        if not isinstance(rows, list) or not rows or any(r.get('date') != key for r in rows):
            raise RuntimeError(f'{key}: BaoStock 日行情为空或日期不匹配；可能尚未入库')
        actual = {}
        for r in rows:
            code = normalize_code(r['code'])
            if not main_board(code):
                continue
            if code in actual:
                raise RuntimeError(f'{key}: 日行情重复股票')
            if r.get('adjustflag') != '3' or r.get('isST') not in ('0', '1'):
                raise RuntimeError(f'{key}: 缺少不复权价格或历史 ST 状态')
            actual[code] = r
        expected = {code for code, r in self.basic().items()
                    if r['ipoDate'] and r['ipoDate'] <= key and (not r['outDate'] or r['outDate'] > key)}
        missing = expected - actual.keys()
        if len(actual) < 2500 or missing:
            raise RuntimeError(f'{key}: 主板行情不完整，缺 {len(missing)} 只，停止发布')
        # 写入通过校验的原始主板数据，失败重跑可复用；临时文件只属于当前进程。
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                json.dump(list(actual.values()), output, ensure_ascii=False, allow_nan=False)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.raw_memory[key] = actual
        return actual

    def pools(self, day):
        key = day.isoformat()
        if key not in self.classified:
            pools = {'up': set(), 'down': set()}
            for code, row in self.raw(day).items():
                basic = self.basic().get(code)
                if not basic or not basic['ipoDate']:
                    raise RuntimeError(f'{key}: 缺少 {code} 上市日期')
                direction = band_direction(row, basic['ipoDate'], self.calendar_days)
                if direction:
                    pools[direction].add(code)
            self.classified[key] = pools
        return self.classified[key]

    def snapshot(self, day):
        if day not in self.calendar_days:
            self.calendar(day - timedelta(days=400), self.end)
        pools = self.pools(day)
        heights = {code: 1 for code in pools['up']}
        active = set(heights)
        index = self.calendar_days.index(day)
        while active:
            index -= 1
            if index < 0:
                raise RuntimeError('连板尚未断开但历史日历已用尽，不能截断板数')
            active &= self.pools(self.calendar_days[index])['up']
            for code in active:
                heights[code] += 1
        rows = self.raw(day)
        st = [code for code, r in rows.items() if r['isST'] == '1']
        daily = [{'ts_code': code, 'close': float(decimal_price(r['close'])),
                  'pre_close': float(decimal_price(r['preclose']))}
                 for code, r in rows.items() if r['isST'] == '0' and r['tradestatus'] == '1']
        return {
            'up': [{'ts_code': code, 'name': code, 'limit_times': heights[code]} for code in sorted(pools['up'])],
            'down': [{'ts_code': code, 'name': code, 'limit_times': 0} for code in sorted(pools['down'])],
            'st': st, 'daily': daily, 'poolSource': self.name, 'quoteSource': self.name,
            'method': '主板10%价格规则，分位四舍五入；排除注册制IPO前5日；特殊重新上市/恢复上市不设限日需人工核对',
        }


class TencentSource:
    name = 'tencent'

    def __init__(self, http):
        self.http = http

    def history(self, symbol='sh000001', end=None):
        result = self.http.json('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
                                {'param': f'{symbol},day,,{end.isoformat() if end else ""},640,qfq'})
        if result.get('code') != 0:
            raise RuntimeError('腾讯历史行情返回错误代码')
        data = result.get('data', {}).get(symbol, {})
        rows = data.get('qfqday') or data.get('day')
        if not rows:
            raise RuntimeError('腾讯历史行情为空')
        return [{'date': r[0], 'close': float(r[2])} for r in rows]

    def calendar(self, start, end):
        rows = self.history(end=end)
        dates = sorted({date.fromisoformat(r['date']) for r in rows})
        if dates[0] > start + timedelta(days=15):
            raise RuntimeError('腾讯指数历史长度不足以覆盖所需日历')
        return [d for d in dates if start <= d <= end]


class SinaSource:
    name = 'sina'

    def __init__(self, http):
        self.http = http

    def history(self, symbol='sh000001', end=None):
        result = self.http.json('https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData',
                                {'symbol': symbol, 'scale': 240, 'ma': 'no', 'datalen': 1023})
        if not isinstance(result, list) or not result:
            raise RuntimeError('新浪日行情为空或格式变化')
        rows = [{'date': r['day'][:10], 'close': float(r['close'])} for r in result]
        if end:
            rows = [r for r in rows if r['date'] <= end.isoformat()]
        return rows

    def calendar(self, start, end):
        rows = self.history(end=end)
        dates = sorted({date.fromisoformat(r['date']) for r in rows})
        if not dates or dates[0] > start + timedelta(days=15):
            raise RuntimeError('新浪指数历史长度不足以覆盖所需日历')
        return [d for d in dates if start <= d <= end]


class EastmoneySource:
    name = 'eastmoney'

    def __init__(self, http):
        self.http = http

    def pool(self, kind, day):
        if day < datetime.now(ZONE).date() - timedelta(days=30):
            raise RuntimeError('东方财富近期股池不足 40 个交易日，需 BaoStock 或本地历史缓存')
        endpoints = {'up': 'getTopicZTPool', 'down': 'getTopicDTPool', 'previous': 'getYesterdayZTPool'}
        result = self.http.json('https://push2ex.eastmoney.com/' + endpoints[kind], {
            'ut': '7eea3edcaed734bea9cbfc24409ed989', 'dpt': 'wz.ztzt',
            'Pageindex': 0, 'pagesize': 10000, 'sort': 'fbt:asc' if kind == 'up' else 'zdp:desc',
            'date': day.strftime('%Y%m%d'),
        })
        data = result.get('data')
        if not isinstance(data, dict) or not isinstance(data.get('pool'), list):
            raise RuntimeError('东方财富股池尚未更新或超出历史覆盖范围')
        if str(data.get('qdate')) != day.strftime('%Y%m%d'):
            raise RuntimeError('东方财富返回日期缺失或错位，拒绝把最新行情用于历史日')
        rows = data['pool']
        if len(rows) >= 10000 or ('tc' in data and int(data['tc']) != len(rows)):
            raise RuntimeError('东方财富股池返回不完整')
        return rows

    def snapshot(self, day):
        pools, st = {}, set()
        for kind in ('up', 'down', 'previous'):
            output = []
            for r in self.pool(kind, day):
                code = normalize_code(r['c'])
                name = r['n'].upper().replace(' ', '')
                if not main_board(code):
                    continue
                if 'ST' in name or '退' in name:
                    st.add(code)
                    continue
                boards = int(r['lbc']) if kind in ('up', 'previous') else 0
                if kind in ('up', 'previous') and boards < 1:
                    raise RuntimeError('东方财富连板数字段无效')
                output.append({'ts_code': code, 'name': r['n'], 'limit_times': boards, 'raw': r})
            if len({r['ts_code'] for r in output}) != len(output):
                raise RuntimeError('东方财富股池重复股票')
            pools[kind] = output
        if not pools['up'] and not pools['down']:
            raise RuntimeError('东方财富涨跌停池同时为空，需要人工核验')
        daily = []
        for stock in pools['previous']:
            row = stock['raw']
            close = float(row['p']) / 1000
            pct = float(row['zdp'])
            if not math.isfinite(pct) or close <= 0 or pct <= -100:
                raise RuntimeError('东方财富昨日涨停表现包含无效行情')
            if float(row.get('amount', 0)) <= 0:
                continue
            daily.append({'ts_code': stock['ts_code'], 'close': close, 'pre_close': close / (1 + pct / 100)})
        return {'up': pools['up'], 'down': pools['down'], 'st': sorted(st), 'daily': daily,
                'poolSource': self.name, 'quoteSource': self.name,
                'method': '东方财富收盘池及昨日池，排除未中断一字涨停新股；与价格推算源可能有口径差异'}


class FreeSources:
    name = 'free'

    def __init__(self, cache_dir, end, preferred='auto'):
        self.end, self.preferred = end, preferred
        self.health = Health()
        http = PublicHTTP()
        self.providers = {
            'baostock': BaoStockSource(Path(cache_dir), end),
            'eastmoney': EastmoneySource(http),
            'tencent': TencentSource(http), 'sina': SinaSource(http),
        }
        self.disabled = set()
        self.calendar_source = None
        self.fallback_used = False

    def calendar(self, start, end):
        failures = []
        for name in ('baostock', 'tencent', 'sina'):
            try:
                result = self.providers[name].calendar(start, end)
                if not result:
                    raise RuntimeError('交易日历为空')
                self.calendar_source = name
                self.health.mark(name, True, f'交易日历可用，截止 {result[-1]}')
                return result
            except (RuntimeError, ValueError, KeyError) as error:
                failures.append(f'{name}: {error}')
                self.health.mark(name, False, str(error))
                if name == 'baostock':
                    self.disabled.add(name)
        raise RuntimeError('所有交易日来源不可用；' + '；'.join(failures))

    def snapshot(self, day):
        candidates = ('baostock', 'eastmoney') if self.preferred == 'auto' else (self.preferred,)
        failures = []
        for name in candidates:
            if name in self.disabled:
                failures.append(f'{name}: 本次已熔断，请查看数据源状态')
                continue
            try:
                result = self.providers[name].snapshot(day)
                self.health.mark(name, True, f'{day} 复盘数据可用')
                if name != 'baostock':
                    self.fallback_used = True
                return result
            except (RuntimeError, ValueError, KeyError, TypeError) as error:
                self.health.mark(name, False, str(error))
                failures.append(f'{name}: {error}')
                # 同一运行中故障源不反复重试，防止 40 日回溯制造请求风暴。
                self.disabled.add(name)
                print(f'数据源切换：{name} 失败，{error}', flush=True)
        raise RuntimeError(f'{day}: 无可用完整复盘来源。' + '；'.join(failures))

    def check(self):
        # 接口连通不等于完整复盘口径能力；每项报告明确写明检查内容。
        for name, provider in self.providers.items():
            try:
                if name == 'baostock':
                    raw = provider.raw(self.end)
                    detail = f'{self.end} 主板日行情 {len(raw)} 条，含历史 ST 标记'
                elif name == 'eastmoney':
                    result = provider.snapshot(self.end)
                    detail = f'{self.end} 涨停 {len(result["up"])} / 跌停 {len(result["down"])}'
                else:
                    rows = provider.history('sh600000', self.end)
                    if not rows or rows[-1]['date'] != self.end.isoformat():
                        raise RuntimeError('个股历史行情截止日期不符')
                    detail = f'个股历史行情验证通过，截止 {rows[-1]["date"]}；非完整复盘源'
                self.health.mark(name, True, detail)
            except (RuntimeError, ValueError, KeyError, TypeError) as error:
                self.health.mark(name, False, str(error))
            print(f'{SOURCE_INFO[name][0]}: {self.health.items[name]["status"]} · {self.health.items[name]["detail"]}', flush=True)
        return self.health.export()
