export interface ReviewDay {
  poolSource?: string
  quoteSource?: string
  method?: string
  date: string
  limitUp: number
  limitDown: number
  consecutive: number
  upPremium: number | null
  consecutivePremium: number | null
  highest: number | null
  lowest: number | null
  upSamples: number
  consecutiveSamples: number
  upExcluded: number
  consecutiveExcluded: number
}

export interface ReviewData {
  schemaVersion: 1
  source: 'demo' | 'tushare' | 'free'
  sourceName?: string
  notice?: string
  calendarSource?: string
  sources?: SourceHealth[]
  generatedAt: string
  rows: ReviewDay[]
}

export type Metric = Exclude<keyof ReviewDay, 'date' | 'poolSource' | 'quoteSource' | 'method'>
export interface ChartSeries {
  key: Metric
  label: string
  color: string
  type: 'bar' | 'line' | 'area'
}

export interface SourceHealth {
  id: string
  name: string
  capability: string
  status: 'ok' | 'unavailable' | 'untested'
  detail: string
  checkedAt: string | null
}
