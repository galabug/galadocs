/* eslint-disable @typescript-eslint/no-require-imports -- 与现有 CommonJS 构建服务共用模块格式 */
'use strict'
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const cache = new Map()
async function remote(url, gb = false) {
  const { stdout } = await execute('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '12', '--max-filesize', '3000000', url], { encoding: 'buffer', maxBuffer: 3000000, timeout: 14000 })
  return new TextDecoder(gb ? 'gb18030' : 'utf-8').decode(stdout)
}
function symbolOf(code) {
  if (/^(?:sh(?:60[0135]|688)\d{3}|sz(?:00[0-3]|30[01])\d{3}|bj(?:[489]\d{5}))$/.test(code)) return code
  if (/^(60[0135]|688)\d{3}$/.test(code)) return `sh${code}`
  if (/^(00[0-3]|30[01])\d{3}$/.test(code)) return `sz${code}`
  if (/^[489]\d{5}$/.test(code)) return `bj${code}`
  throw new Error('请输入有效的沪深北 A 股六位代码')
}
function boardOf(symbol) {
  if (symbol.startsWith('bj')) return { id: 'bse', label: '北交所', benchmark: 'bj899050', benchmarkName: '北证50', limit: 30 }
  if (symbol.startsWith('sh688')) return { id: 'star', label: '科创板', benchmark: 'sh000688', benchmarkName: '科创50', limit: 20 }
  if (symbol.startsWith('sz30')) return { id: 'chinext', label: '创业板', benchmark: 'sz399102', benchmarkName: '创业板综', limit: 20 }
  return { id: symbol.startsWith('sh') ? 'sh' : 'sz', label: symbol.startsWith('sh') ? '沪市主板' : '深市主板', benchmark: symbol.startsWith('sh') ? 'sh000002' : 'sz399107', benchmarkName: symbol.startsWith('sh') ? '上证A股' : '深证A指', limit: 10 }
}
async function search(q) {
  if (!q || q.length > 30) throw new Error('请输入 1—30 个字符的名称或代码')
  if (/^(sh|sz|bj)?\d{6}$/.test(q.toLowerCase())) {
    const symbol = symbolOf(q.toLowerCase())
    const quotes = await quote([symbol])
    if (!quotes[symbol]) throw new Error('没有查询到该股票')
    return [{ symbol, code: symbol.slice(2), name: quotes[symbol].name }]
  }
  const text = await remote(`https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(q)}&t=all`)
  const encoded = text.match(/v_hint\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1]
  if (!encoded) throw new Error('股票名称搜索暂不可用，请直接输入六位代码')
  return JSON.parse(encoded)
    .split('^')
    .flatMap((item) => {
      const [market, code, name, , type] = item.split('~')
      if (type !== 'GP-A') return []
      try {
        const symbol = symbolOf(`${market}${code}`)
        return [{ symbol, code, name }]
      } catch {
        return []
      }
    })
    .slice(0, 12)
}
async function quote(symbols) {
  const text = await remote(`https://qt.gtimg.cn/q=${symbols.join(',')}`, true)
  const result = {}
  for (const m of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
    const f = m[2].split('~')
    if (f.length < 33 || !(Number(f[4]) > 0) || !(Number(f[3]) > 0) || !/^\d{14}$/.test(f[30])) continue
    result[m[1]] = { name: f[1], price: Number(f[3]), previousClose: Number(f[4]), timestamp: f[30], upper: Number(f[47]), lower: Number(f[48]) }
  }
  return result
}
async function history(symbol) {
  const isIndex = ['sh000002', 'sh000688', 'sz399107', 'sz399102', 'bj899050'].includes(symbol)
  let rows,
    source = '腾讯证券前复权'
  try {
    const body = JSON.parse(await remote(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,100,qfq`))
    const data = body.data?.[symbol]
    rows = data?.qfqday || (isIndex ? data?.day : null)
    if (body.code !== 0 || !Array.isArray(rows) || rows.length < 2) throw new Error('历史行情不足')
    rows = rows.map((r) => ({ date: r[0], close: Number(r[2]) }))
  } catch {
    const raw = JSON.parse(await remote(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=100`))
    if (!Array.isArray(raw) || raw.length < 2) throw new Error('个股或指数历史行情不足，暂不能计算')
    let factors = [{ d: '1900-01-01', f: 1 }]
    if (!isIndex) {
      const text = await remote(`https://finance.sina.com.cn/realstock/company/${symbol}/hfq.js`)
      const encoded = text.split('\n')[0].match(/=\s*(\{.*\})/)?.[1]
      const parsed = encoded && JSON.parse(encoded)
      if (!Array.isArray(parsed?.data) || !parsed.data.length) throw new Error('备用行情缺少复权因子，停止计算')
      factors = parsed.data.map((r) => ({ d: r.d, f: Number(r.f) })).sort((a, b) => b.d.localeCompare(a.d))
      if (factors.some((r) => !(r.f > 0))) throw new Error('复权因子无效')
    }
    const factor = (date) => factors.find((r) => r.d <= date)?.f
    const latest = factor(raw.at(-1).day.slice(0, 10))
    rows = raw.map((r) => ({ date: r.day.slice(0, 10), close: (Number(r.close) * factor(r.day.slice(0, 10))) / latest }))
    source = isIndex ? '新浪指数行情' : '新浪行情 + 复权因子'
  }
  if (rows.some((r, i) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(r.close) || r.close <= 0 || (i > 0 && r.date <= rows[i - 1].date))) throw new Error('历史行情格式或日期顺序异常')
  return { rows, source }
}

async function load(symbol) {
  const saved = cache.get(symbol)
  if (saved && Date.now() - saved.at < 15000) return saved.data
  const board = boardOf(symbol)
  const [stockData, indexData, quotes] = await Promise.all([history(symbol), history(board.benchmark), quote([symbol, board.benchmark])])
  const stock = stockData.rows,
    index = indexData.rows
  const live = quotes[symbol],
    indexLive = quotes[board.benchmark]
  if (!live || !indexLive || live.timestamp.slice(0, 8) !== indexLive.timestamp.slice(0, 8)) throw new Error('个股与指数行情日期不一致，请稍后重新查询')
  const date = `${live.timestamp.slice(0, 4)}-${live.timestamp.slice(4, 6)}-${live.timestamp.slice(6, 8)}`
  const stockMap = new Map(stock.map((r) => [r.date, r.close]))
  const indexMap = new Map(index.map((r) => [r.date, r.close]))
  const priorStock = stock.filter((r) => r.date < date).at(-1)
  if (!priorStock || !index.filter((r) => r.date < date).length) throw new Error('缺少上一交易日数据')
  // 将前复权历史衔接到实时昨收基准，避免当日除权造成假跳变。
  const scale = live.previousClose / priorStock.close
  const dates = index.filter((r) => r.date < date && r.date >= stock[0].date).map((r) => r.date)
  if (dates.some((d) => !stockMap.has(d))) throw new Error('近期存在停牌或日行情缺口，无法可靠对齐交易日，暂不自动计算')
  const rows = dates.map((d) => ({ date: d, stockClose: stockMap.get(d) * scale, indexClose: indexMap.get(d) }))
  rows.push({ date, stockClose: live.price, indexClose: indexLive.price })
  if (rows.length < 4) throw new Error('历史样本不足，不能生成三日异动结果')
  const stamp = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`
  const data = {
    symbol,
    code: symbol.slice(2),
    name: live.name,
    board,
    rows: rows.slice(-91),
    price: live.price,
    previousClose: live.previousClose,
    indexPreviousClose: indexLive.previousClose,
    upper: live.upper > 0 ? live.upper : null,
    lower: live.lower > 0 ? live.lower : null,
    quoteAt: stamp(live.timestamp),
    indexAt: stamp(indexLive.timestamp),
    source: `${stockData.source} / ${indexData.source} · 腾讯行情快照`,
    excluded: /^[NC退]/.test(live.name) || /退$/.test(live.name),
    fetchedAt: new Date().toISOString(),
  }
  cache.set(symbol, { at: Date.now(), data })
  if (cache.size > 100) cache.delete(cache.keys().next().value)
  return data
}
async function handle(req, res, url) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  if (req.method !== 'GET') return send(405, { error: '只支持 GET 查询' })
  try {
    if (url.pathname === '/review/api/anomaly/search') return send(200, { results: await search((url.searchParams.get('q') || '').trim()) })
    if (url.pathname === '/review/api/anomaly/stock') return send(200, await load(symbolOf((url.searchParams.get('symbol') || '').toLowerCase())))
    send(404, { error: '接口不存在' })
  } catch (error) {
    send(502, { error: error.message?.includes('curl') || error.code ? '免费行情源连接失败，请稍后重新查询' : error.message })
  }
}
module.exports = { handle, symbolOf, boardOf }
