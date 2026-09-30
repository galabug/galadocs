<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { formatValue } from '@/utils/review'
import type { ChartSeries, ReviewDay } from '@/types/review'

const props = defineProps<{ rows: ReviewDay[]; selectedDate: string }>()
const emit = defineEmits<{ select: [date: string] }>()
const hidden = ref<string[]>([])
const labels = ref(true)
const hovered = ref<string | null>(null)
const plot = ref<HTMLDivElement | null>(null)
const bands: { title: string; unit: string; series: ChartSeries[] }[] = [
  {
    title: '封板数量',
    unit: '家',
    series: [
      { key: 'limitUp', label: '涨停家数', color: '#ff8492', type: 'bar' },
      { key: 'limitDown', label: '跌停家数', color: '#62d9b1', type: 'bar' },
      { key: 'consecutive', label: '连板家数', color: '#e9be66', type: 'area' },
    ],
  },
  {
    title: '昨日强势股今日溢价',
    unit: '%',
    series: [
      { key: 'upPremium', label: '昨日涨停溢价', color: '#eea76c', type: 'area' },
      { key: 'consecutivePremium', label: '昨日连板溢价', color: '#99c785', type: 'area' },
    ],
  },
  {
    title: '连板高度',
    unit: '板',
    series: [
      { key: 'highest', label: '最高连板', color: '#eea76c', type: 'line' },
      { key: 'secondHighest', label: '次高连板', color: '#80baff', type: 'line' },
    ],
  },
]
const width = computed(() => Math.max(1000, props.rows.length * 64 + 84))
const step = computed(() => (width.value - 84) / Math.max(props.rows.length, 1))
const x = (i: number) => 70 + (i + 0.5) * step.value
const focusDate = computed(() => hovered.value ?? props.selectedDate)
const focusRow = computed(() => props.rows.find((r) => r.date === focusDate.value))
async function scrollToLatest() {
  await nextTick()
  if (plot.value) plot.value.scrollLeft = plot.value.scrollWidth
}
onMounted(scrollToLatest)
watch(
  () => [props.rows.length, props.rows[props.rows.length - 1]?.date],
  scrollToLatest,
  { flush: 'post' },
)
const plotted = computed(() =>
  bands.map((band, index) => {
    const series = band.series.filter((s) => !hidden.value.includes(s.key))
    const values = props.rows.flatMap((r) => series.map((s) => r[s.key])).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const min = Math.floor(Math.min(0, ...values))
    const max = Math.max(min + 1, Math.ceil(Math.max(1, ...values)))
    const top = 76 + index * 190
    return { ...band, series, top, min, max, y: (v: number) => top + 132 - ((v - min) / (max - min)) * 132 }
  }),
)
function toggle(key: string) {
  hidden.value = hidden.value.includes(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key]
}
function segments(s: ChartSeries, y: (v: number) => number) {
  const groups: { x: number; y: number }[][] = []
  let points: { x: number; y: number }[] = []
  props.rows.forEach((row, i) => {
    const v = row[s.key]
    if (v == null) {
      if (points.length) groups.push(points)
      points = []
    } else points.push({ x: x(i), y: y(v) })
  })
  if (points.length) groups.push(points)
  return groups.map((points) => {
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
    return { line, area: `${line} L${points[points.length - 1]!.x},${y(0)} L${points[0]!.x},${y(0)} Z` }
  })
}
</script>

<template>
  <section class="overview-chart" aria-label="复盘指标合成图">
    <header>
      <div>
        <h2>同一时间轴 · 市场复盘</h2>
        <p>数量、溢价、连板高度分区共用日期，各区保留真实单位；空值断线。</p>
      </div>
      <label><input v-model="labels" type="checkbox" /> 显示数值</label>
    </header>
    <div class="legend">
      <button v-for="s in bands.flatMap((b) => b.series)" :key="s.key" :aria-pressed="!hidden.includes(s.key)" :class="{ muted: hidden.includes(s.key) }" @click="toggle(s.key)"><i :style="{ background: s.color }"></i>{{ s.label }}</button>
    </div>
    <div class="reading" aria-live="polite">
      <b>{{ focusDate }}</b
      ><span v-for="s in bands.flatMap((b) => b.series).filter((s) => !hidden.includes(s.key))" :key="s.key"
        ><i :style="{ background: s.color }"></i>{{ s.label }} <strong>{{ formatValue(focusRow?.[s.key], s.key.includes('Premium')) }}</strong></span
      >
    </div>
    <p class="hint">横向滚动查看所有日期 · 悬停联动读数 · 点击锁定复盘日期 · 图例可隐藏指标</p>
    <div ref="plot" class="scroll-plot" @mouseleave="hovered = null">
      <svg :viewBox="`0 0 ${width} 640`" :style="{ width: `${width}px` }" role="group" aria-label="数量、溢价和连板高度共享日期的组合图">
        <g v-for="(row, i) in rows" :key="row.date">
          <rect :x="70 + i * step" y="0" :width="step" height="32" :fill="row.date === focusDate ? '#668567' : '#284537'" stroke="#182a26" />
          <text :x="x(i)" y="21" text-anchor="middle" fill="#e1efdf">{{ row.date.slice(5).replace('-', '.') }}</text>
        </g>
        <g v-for="band in plotted" :key="band.title">
          <text x="12" :y="band.top - 16" fill="#b9c8d9">{{ band.title }} · {{ band.unit }}</text>
          <g v-for="v in [band.min, (band.min + band.max) / 2, band.max]" :key="v">
            <line x1="70" :x2="width - 14" :y1="band.y(v)" :y2="band.y(v)" stroke="#2e3948" stroke-dasharray="3 4" />
            <text x="58" :y="band.y(v) + 4" text-anchor="end" fill="#9cabbf">{{ Number(v.toFixed(1)) }}</text>
          </g>
          <line x1="70" :x2="width - 14" :y1="band.y(0)" :y2="band.y(0)" stroke="#607086" />
          <g v-for="s in band.series" :key="s.key">
            <template v-if="s.type !== 'bar'">
              <g v-for="(segment, i) in segments(s, band.y)" :key="i">
                <path v-if="s.type === 'area'" :d="segment.area" :fill="s.color" fill-opacity=".22" />
                <path :d="segment.line" fill="none" :stroke="s.color" stroke-width="2.5" />
              </g>
            </template>
            <g v-for="(row, i) in rows" :key="row.date">
              <template v-if="row[s.key] != null">
                <rect v-if="s.type === 'bar'" :x="x(i) + (s.key === 'limitUp' ? -20 : 2)" :y="Math.min(band.y(row[s.key]!), band.y(0))" width="18" :height="Math.abs(band.y(row[s.key]!) - band.y(0))" :fill="s.color" fill-opacity=".75" rx="2" />
                <circle v-else :cx="x(i)" :cy="band.y(row[s.key]!)" :r="s.type === 'line' ? 5 : 2.5" :fill="s.color" />
                <text v-if="labels" :x="x(i) + (s.type === 'bar' ? (s.key === 'limitUp' ? -11 : 11) : 0)" :y="band.y(row[s.key]!) + (s.key === 'secondHighest' || s.key === 'consecutivePremium' ? 18 : -9)" :fill="s.color" text-anchor="middle" class="value-label">{{ s.key.includes('Premium') ? row[s.key]!.toFixed(1) : row[s.key] }}</text>
              </template>
            </g>
          </g>
        </g>
        <g v-for="(row, i) in rows" :key="row.date">
          <line v-if="row.date === focusDate" :x1="x(i)" :x2="x(i)" y1="32" y2="610" stroke="#d9e4f3" stroke-dasharray="4 5" opacity=".65" />
          <rect
            :x="70 + i * step"
            y="0"
            :width="step"
            height="625"
            fill="transparent"
            tabindex="0"
            role="button"
            :aria-label="`合成图查看 ${row.date}`"
            :aria-pressed="row.date === selectedDate"
            @mouseenter="hovered = row.date"
            @focus="hovered = row.date"
            @blur="hovered = null"
            @click="emit('select', row.date)"
            @keydown.enter="emit('select', row.date)"
            @keydown.space.prevent="emit('select', row.date)"
          />
        </g>
      </svg>
    </div>
  </section>
</template>

<style scoped>
.overview-chart {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  padding: 22px;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
}
h2 {
  margin: 0 0 8px;
  font-size: 17px;
}
p {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
  line-height: 1.7;
}
header label {
  font-size: 12px;
  white-space: nowrap;
  color: #b9c8d9;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 22px;
  margin: 22px 0 16px;
}
.legend button {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: 0;
  padding: 4px 0;
  color: #d4deeb;
  font-size: 12px;
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.muted {
  opacity: 0.35;
}
.reading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
  min-height: 48px;
  padding: 12px;
  background: #ffffff06;
  border-radius: 8px;
  font-size: 12px;
}
.reading span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #b9c8d9;
}
.reading strong {
  color: #eef3fb;
}
.hint {
  margin: 12px 0;
}
.scroll-plot {
  overflow-x: auto;
  scrollbar-color: #64758b #17202d;
}
svg {
  display: block;
  height: 640px;
  font-family: inherit;
  font-size: 11px;
}
.value-label {
  paint-order: stroke;
  stroke: #17202d;
  stroke-width: 3px;
  stroke-linejoin: round;
  font-size: 10px;
  font-weight: 600;
}
svg [role='button'] {
  cursor: crosshair;
}
svg [role='button']:focus-visible {
  outline: 2px solid #9bb8ff;
  outline-offset: -2px;
}
@media (max-width: 600px) {
  .overview-chart {
    padding: 14px;
  }
  header {
    flex-wrap: wrap;
  }
}
</style>
