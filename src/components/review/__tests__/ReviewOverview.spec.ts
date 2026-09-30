import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReviewOverview from '../ReviewOverview.vue'

const row = { date: '2026-09-28', limitUp: 31, limitDown: 59, consecutive: 7, upPremium: -2.19, consecutivePremium: null, highest: 5, secondHighest: 2, highestStocks: [{ code: '600002.SH', name: '最高股', boards: 5 }], secondHighestStocks: [{ code: '600003.SH', name: '次高股', boards: 2 }], oneWordCount: 1, oneWordHighest: 6, oneWordStocks: [{ code: '600001.SH', name: '一字股', boards: 6 }], heightUnknown: 0, upSamples: 47, consecutiveSamples: 13, upExcluded: 0, consecutiveExcluded: 0 }
describe('combined overview', () => {
  it('toggles a metric and value labels and selects a shared date', async () => {
    const wrapper = mount(ReviewOverview, { props: { rows: [row], selectedDate: row.date } })
    const legend = wrapper.findAll('button').find((b) => b.text() === '次高连板')!
    await legend.trigger('click')
    expect(legend.attributes('aria-pressed')).toBe('false')
    await wrapper.get('input').setValue(false)
    expect(wrapper.findAll('.value-label')).toHaveLength(0)
    await wrapper.get('rect[role="button"]').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([row.date])
    expect(wrapper.html()).not.toContain('NaN')
    expect(wrapper.text()).toContain('最高股')
    expect(wrapper.text()).toContain('次高股')
    expect(wrapper.findAll('path[stroke-dasharray="7 5"]').length).toBeGreaterThan(0)
  })
  it('keeps band explanations visible and shows names for a clicked date', async () => {
    const next = { ...row, date: '2026-09-29', highestStocks: [{ code: '600004.SH', name: '另一只', boards: 5 }] }
    const wrapper = mount(ReviewOverview, { props: { rows: [row, next], selectedDate: next.date } })
    expect(wrapper.find('.band-index').text()).toContain('连板高度')
    expect(wrapper.find('.height-stocks').text()).toContain('另一只')
    await wrapper.findAll('rect[role="button"]')[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([row.date])
    await wrapper.setProps({ selectedDate: row.date })
    expect(wrapper.find('.height-stocks').text()).toContain('最高股')
    expect(wrapper.find('.height-stocks').text()).toContain('一字股')
  })
  it('shows the matching stock names when each height point is hovered', async () => {
    const wrapper = mount(ReviewOverview, { props: { rows: [row], selectedDate: row.date } })
    for (const [series, name] of [
      ['最高连板', '最高股'],
      ['次高连板', '次高股'],
      ['前二全程一字板', '一字股'],
    ] as const) {
      const point = wrapper.findAll('.height-point-hit').find((hit) => hit.attributes('aria-label')?.includes(series))!
      await point.trigger('mouseenter')
      expect(wrapper.get('.point-tooltip').text()).toContain(name)
      await point.trigger('mouseleave')
      expect(wrapper.find('.point-tooltip').exists()).toBe(false)
    }
  })
})
