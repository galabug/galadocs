import { describe, expect, it } from 'vitest'
import { formatValue, oneWordTopTwo, parseReview, parseSourceHealth, sourceLabel } from '@/utils/review'

const row = {
  date: '2026-09-24',
  limitUp: 10,
  limitDown: 2,
  consecutive: 2,
  upPremium: null,
  consecutivePremium: -1.25,
  highest: 4,
  secondHighest: 2,
  highestStocks: [{ code: '600001.SH', name: '样本甲', boards: 4 }],
  secondHighestStocks: [{ code: '600002.SH', name: '样本乙', boards: 2 }],
  oneWordCount: 0,
  oneWordHighest: null,
  oneWordStocks: [],
  heightUnknown: 0,
  upSamples: 0,
  consecutiveSamples: 3,
  upExcluded: 1,
  consecutiveExcluded: 0,
}
const data = {
  schemaVersion: 1,
  source: 'demo',
  generatedAt: '2026-09-24 20:30:00',
  rows: [row],
}

describe('review data', () => {
  it('keeps missing values distinct from zero', () => {
    expect(formatValue(null, true)).toBe('—')
    expect(formatValue(0, true)).toBe('0.00%')
    expect(formatValue(-1.25, true)).toBe('-1.25%')
    expect(parseReview(data).rows[0]?.upPremium).toBeNull()
  })
  it('rejects duplicates, non-finite values and inconsistent heights', () => {
    expect(() => parseReview({ ...data, rows: [row, row] })).toThrow()
    expect(() => parseReview({ ...data, rows: [{ ...row, upPremium: NaN }] })).toThrow()
    expect(() => parseReview({ ...data, rows: [{ ...row, consecutive: 0 }] })).toThrow()
    expect(() => parseReview({ ...data, rows: [{ ...row, secondHighest: 1 }] })).toThrow()
    expect(parseReview({ ...data, rows: [{ ...row, secondHighest: 4, secondHighestStocks: row.highestStocks }] }).rows[0]?.secondHighest).toBe(4)
    expect(() => parseReview({ ...data, rows: [{ ...row, secondHighest: 5 }] })).toThrow()
    expect(() => parseReview({ ...data, rows: [{ ...row, oneWordCount: 1 }] })).toThrow()
    expect(parseReview({ ...data, rows: [{ ...row, oneWordCount: 1, oneWordHighest: 6, oneWordStocks: [{ code: '600003.SH', name: '一字股', boards: 6 }], highest: 4, secondHighest: null, secondHighestStocks: [] }] }).rows[0]?.oneWordHighest).toBe(6)
  })
  it('plots one-word height only when it enters the top two', () => {
    expect(oneWordTopTwo({ ...row, oneWordCount: 1, oneWordHighest: 3, oneWordStocks: [{ code: '600003.SH', name: '一字股', boards: 3 }] })).toBe(3)
    expect(oneWordTopTwo({ ...row, secondHighest: 3, oneWordCount: 1, oneWordHighest: 2, oneWordStocks: [{ code: '600003.SH', name: '一字股', boards: 2 }] })).toBeNull()
    expect(oneWordTopTwo({ ...row, oneWordCount: 1, oneWordHighest: 6, oneWordStocks: [{ code: '600003.SH', name: '一字股', boards: 6 }], heightUnknown: 1 })).toBeNull()
  })
  it('sorts history and rejects unknown provenance', () => {
    expect(
      parseReview({ ...data, rows: [row, { ...row, date: '2026-09-23' }] }).rows[0]?.date,
    ).toBe('2026-09-23')
    expect(() => parseReview({ ...data, source: 'unknown' })).toThrow()
  })
})

describe('free sources', () => {
  it('accepts free data and validates provider health', () => {
    const sources = [
      {
        id: 'baostock',
        name: 'BaoStock',
        capability: '完整复盘',
        status: 'ok',
        detail: '实测通过',
        checkedAt: '2026-09-28T20:30:00+08:00',
      },
    ]
    expect(parseReview({ ...data, source: 'free', sources }).source).toBe('free')
    expect(parseSourceHealth(sources)[0]?.status).toBe('ok')
    expect(sourceLabel('baostock')).toBe('BaoStock')
    expect(() => parseSourceHealth([{ ...sources[0], status: 'healthy' }])).toThrow()
    expect(() => parseSourceHealth([{ ...sources[0], checkedAt: 'invalid' }])).toThrow()
  })
})
