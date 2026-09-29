"""Isolate the vendor socket client so a stalled request has a hard timeout."""
from contextlib import redirect_stdout
import io
import json
import socket
import sys


def execute(bs, operation, params):
    calls = {
        'calendar': bs.query_trade_dates,
        'daily': bs.query_daily_history_k_AStock,
        'basic': bs.query_stock_basic,
    }
    result = calls[operation](**params)
    rows = []
    while result.error_code == '0' and result.next():
        rows.append(dict(zip(result.fields, result.get_row_data())))
    if result.error_code != '0':
        raise RuntimeError(f'BaoStock {operation} 查询失败 ({result.error_code})')
    return rows


def connect():
    socket.setdefaulttimeout(15)
    try:
        import baostock as bs
    except ImportError:
        raise RuntimeError('请安装 scripts/market_review/requirements.txt 中的依赖') from None
    if not hasattr(bs, 'query_daily_history_k_AStock'):
        raise RuntimeError('需要 BaoStock 0.9.4，请更新项目虚拟环境')
    result = bs.login()  # 官方 anonymous 默认登录，无需注册，无用户凭据。
    if result.error_code != '0':
        raise RuntimeError(f'公共节点连接失败 ({result.error_code})')
    return bs


def run(operation, params):
    bs = connect()
    try:
        return execute(bs, operation, params)
    finally:
        bs.logout()


def serve():
    bs = None
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                with redirect_stdout(io.StringIO()):
                    if bs is None:
                        bs = connect()
                    rows = execute(bs, request['operation'], request['params'])
                print(json.dumps({'rows': rows}, ensure_ascii=False, allow_nan=False), flush=True)
            except Exception as error:
                print(json.dumps({'error': str(error)}, ensure_ascii=False), flush=True)
    finally:
        if bs:
            with redirect_stdout(io.StringIO()):
                bs.logout()


if __name__ == '__main__':
    if sys.argv[1] == '--serve':
        serve()
        sys.exit(0)
    try:
        with redirect_stdout(io.StringIO()):
            rows = run(sys.argv[1], json.loads(sys.argv[2]))
        print(json.dumps({'rows': rows}, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
