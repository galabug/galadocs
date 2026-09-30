import type { ReviewData, ReviewDay, SourceHealth } from '@/types/review'

export function oneWordTopTwo(row: ReviewDay): number | null {
  if (row.oneWordHighest === null || row.heightUnknown > 0) return null
  if (row.secondHighest !== null && row.oneWordHighest < row.secondHighest) return null
  return row.oneWordHighest
}

export function formatValue(value: number | null | undefined, percent = false): string {
  if (value == null) return '—'
  return percent ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : String(value)
}

export function parseReview(value: unknown): ReviewData {
  const data = value as ReviewData
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !['demo', 'tushare', 'free'].includes(data.source) ||
    typeof data.generatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(data.generatedAt) ||
    !Number.isFinite(Date.parse(data.generatedAt.replace(' ', 'T') + '+08:00')) ||
    !Array.isArray(data.rows) ||
    !data.rows.length
  ) {
    throw new Error('数据文件格式不正确或尚无记录，请重新运行采集程序。')
  }
  const seen = new Set<string>()
  const counts = [
    'limitUp',
    'limitDown',
    'consecutive',
    'upSamples',
    'consecutiveSamples',
    'upExcluded',
    'consecutiveExcluded',
    'oneWordCount',
    'heightUnknown',
  ] as const
  const optional = ['highest', 'secondHighest', 'oneWordHighest', 'upPremium', 'consecutivePremium'] as const
  const validStock = (stock: ReviewDay['oneWordStocks'][number]): boolean =>
    Boolean(stock) &&
    /^(600|601|603|605|000|001|002|003)\d{3}\.(SH|SZ)$/.test(stock.code) &&
    typeof stock.name === 'string' && stock.name.length > 0 &&
    Number.isInteger(stock.boards) && stock.boards >= 2
  for (const row of data.rows) {
    if (
      !row ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(Date.parse(row.date)) ||
      new Date(row.date).toISOString().slice(0, 10) !== row.date ||
      seen.has(row.date) ||
      counts.some((key) => !Number.isInteger(row[key]) || row[key] < 0) ||
      optional.some(
        (key) => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key])),
      ) ||
      row.consecutive > row.limitUp ||
      !Array.isArray(row.highestStocks) ||
      !Array.isArray(row.secondHighestStocks) ||
      !Array.isArray(row.oneWordStocks) ||
      row.oneWordStocks.length !== row.oneWordCount ||
      row.oneWordCount + row.heightUnknown > row.consecutive ||
      row.oneWordStocks.some((stock) => !validStock(stock)) ||
      row.highestStocks.some((stock) => !validStock(stock) || stock.boards !== row.highest) ||
      row.secondHighestStocks.some((stock) => !validStock(stock) || stock.boards !== row.secondHighest) ||
      (row.highest === null && row.highestStocks.length > 0) ||
      (row.secondHighest === null && row.secondHighestStocks.length > 0) ||
      (data.source !== 'demo' && row.highest !== null && row.highestStocks.length === 0) ||
      (data.source !== 'demo' && row.secondHighest !== null && row.secondHighestStocks.length === 0) ||
      (row.oneWordCount === 0 ? row.oneWordHighest !== null :
        row.oneWordHighest !== Math.max(...row.oneWordStocks.map((stock) => stock.boards))) ||
      (row.heightUnknown > 0 || row.consecutive === row.oneWordCount
        ? row.highest !== null || row.secondHighest !== null
        : row.highest === null ||
          !Number.isInteger(row.highest) || row.highest < 2 ||
          (row.secondHighest !== null &&
            (!Number.isInteger(row.secondHighest) || row.secondHighest < 2 || row.secondHighest > row.highest)))
    ) {
      throw new Error('数据含有重复日期或无效指标，请检查采集日志。')
    }
    seen.add(row.date)
  }
  if (data.sources) parseSourceHealth(data.sources)
  return { ...data, rows: [...data.rows].sort((a, b) => a.date.localeCompare(b.date)) }
}

export function parseSourceHealth(value: unknown): SourceHealth[] {
  if (!Array.isArray(value)) throw new Error('数据源状态格式异常')
  return value.map((item: SourceHealth) => {
    if (
      !item ||
      !['baostock', 'eastmoney', 'tencent', 'sina'].includes(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.capability !== 'string' ||
      typeof item.detail !== 'string' ||
      !['ok', 'unavailable', 'untested'].includes(item.status) ||
      (item.checkedAt !== null &&
        (typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt))))
    ) {
      throw new Error('数据源状态格式异常')
    }
    return item
  })
}

export function sourceLabel(source?: string): string {
  const names: Record<string, string> = {
    baostock: 'BaoStock',
    eastmoney: '东方财富',
    tencent: '腾讯证券',
    sina: '新浪财经',
    tushare: 'Tushare',
    free: '免费多源',
    demo: '模拟数据',
  }
  return names[source ?? ''] ?? '未标明'
}
