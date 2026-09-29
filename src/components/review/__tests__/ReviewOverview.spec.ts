import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReviewOverview from '../ReviewOverview.vue'

const row = { date: '2026-09-28', limitUp: 31, limitDown: 59, consecutive: 7, upPremium: -2.19, consecutivePremium: null, highest: 5, secondHighest: 2, upSamples: 47, consecutiveSamples: 13, upExcluded: 0, consecutiveExcluded: 0 }
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
  })
})
