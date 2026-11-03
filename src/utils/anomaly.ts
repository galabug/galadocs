export interface PriceRow {
  date: string
  stockClose: number
  indexClose: number
}
export interface AnomalyStock {
  symbol: string
  code: string
  name: string
  board: { id: string; label: string; benchmark: string; benchmarkName: string; limit: number }
  rows: PriceRow[]
  price: number
  previousClose: number
  indexPreviousClose: number
  upper: number | null
  lower: number | null
  quoteAt: string
  indexAt: string
  source: string
  excluded: boolean
}
export interface Trigger {
  days: number
  start: string
  deviation: number
  upPrice: number
  downPrice: number
}
export interface WindowResult {
  horizon: number
  available: number
  currentHigh: Trigger | null
  currentLow: Trigger | null
  up: Trigger | null
  down: Trigger | null
}
export function calculateWindow(rows: PriceRow[], horizon: number, positive: number, negative: number, resetDate = ''): WindowResult {
  const end = rows[rows.length - 1]
  const windows: Trigger[] = []
  if (!end) return { horizon, available: 0, currentHigh: null, currentLow: null, up: null, down: null }
  for (let days = 1; days <= Math.min(horizon, rows.length - 1); days++) {
    const base = rows[rows.length - 1 - days]!
    const start = rows[rows.length - days]!.date
    if (resetDate && start < resetDate) continue
    const ratio = end.indexClose / base.indexClose
    const up = base.stockClose * (ratio + positive / 100)
    const down = base.stockClose * (ratio + negative / 100)
    windows.push({
      days,
      start,
      deviation: (end.stockClose / base.stockClose - ratio) * 100,
      upPrice: Math.ceil((up - 1e-9) * 100) / 100,
      downPrice: Math.floor((down + 1e-9) * 100) / 100,
    })
  }
  return {
    horizon,
    available: windows.length,
    currentHigh: [...windows].sort((a, b) => b.deviation - a.deviation)[0] ?? null,
    currentLow: [...windows].sort((a, b) => a.deviation - b.deviation)[0] ?? null,
    up: [...windows].sort((a, b) => a.upPrice - b.upPrice)[0] ?? null,
    down: [...windows].sort((a, b) => b.downPrice - a.downPrice)[0] ?? null,
  }
}
export function ruleThresholds(board: string): { ordinary: number; ten: number; thirty: number; tenDown: number; thirtyDown: number; events: number } {
  return board === 'bse' ? { ordinary: 40, ten: 150, thirty: 300, tenDown: -60, thirtyDown: -75, events: 3 } : { ordinary: ['star', 'chinext'].includes(board) ? 30 : 20, ten: 100, thirty: 200, tenDown: -50, thirtyDown: -70, events: ['star', 'chinext'].includes(board) ? 3 : 4 }
}
