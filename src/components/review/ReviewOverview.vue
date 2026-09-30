<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { formatValue, oneWordTopTwo } from '@/utils/review'
import type { ChartSeries, HeightStock, ReviewDay } from '@/types/review'

const props = defineProps<{ rows: ReviewDay[]; selectedDate: string }>()
const emit = defineEmits<{ select: [date: string] }>()
const hidden = ref<string[]>([])
const labels = ref(true)
const hovered = ref<string | null>(null)
const hoveredPoint = ref<{
  date: string
  label: string
  value: number
  stocks: HeightStock[]
  left: number
  top: number
  below: boolean
  width: number
} | null>(null)
const plot = ref<HTMLDivElement | null>(null)
type OverviewSeries = Omit<ChartSeries, 'key'> & { key: ChartSeries['key'] | 'oneWordTopTwo'; dashed?: boolean }
const bands: { title: string; unit: string; series: OverviewSeries[] }[] = [
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
      { key: 'oneWordTopTwo', label: '前二全程一字板', color: '#f2ce68', type: 'line', dashed: true },
    ],
  },
]
const width = computed(() => Math.max(1000, props.rows.length * 64 + 84))
const step = computed(() => (width.value - 84) / Math.max(props.rows.length, 1))
const x = (i: number) => 70 + (i + 0.5) * step.value
const seriesX = (i: number, series: OverviewSeries) =>
  x(i) + (series.key === 'highest' ? -12 : series.key === 'oneWordTopTwo' ? 12 : 0)
const focusDate = computed(() => hovered.value ?? props.selectedDate)
const focusRow = computed(() => props.rows.find((r) => r.date === focusDate.value))
const selectedRow = computed(() => props.rows.find((r) => r.date === props.selectedDate))
const selectedOneWordTopTwo = computed(() => selectedRow.value ? oneWordTopTwo(selectedRow.value) : null)
function names(stocks: HeightStock[]): string {
  return stocks.map((stock) => `${stock.name}（${stock.code}）`).join('、') || '—'
}
function seriesValue(row: ReviewDay, series: OverviewSeries): number | null {
  return series.key === 'oneWordTopTwo' ? oneWordTopTwo(row) : row[series.key]
}
function valueLabel(value: number | null, series: OverviewSeries): string {
  if (value === null) return ''
  return series.key.includes('Premium') ? value.toFixed(1) : String(value)
}
function pointStocks(row: ReviewDay, series: OverviewSeries): HeightStock[] {
  if (series.key === 'highest') return row.highestStocks
  if (series.key === 'secondHighest') return row.secondHighestStocks
  if (series.key === 'oneWordTopTwo') {
    return row.oneWordStocks.filter((stock) => stock.boards === oneWordTopTwo(row))
  }
  return []
}
function showHeightPoint(row: ReviewDay, index: number, series: OverviewSeries, y: (value: number) => number) {
  const value = seriesValue(row, series)
  if (value === null) return
  const pointY = y(value)
  const viewportWidth = plot.value?.clientWidth ?? width.value
  const viewportLeft = plot.value?.scrollLeft ?? 0
  const tooltipWidth = Math.min(270, Math.max(120, viewportWidth - 16))
  const half = tooltipWidth / 2
  hovered.value = row.date
  hoveredPoint.value = {
    date: row.date,
    label: series.label,
    value,
    stocks: pointStocks(row, series),
    left: Math.min(viewportLeft + viewportWidth - half - 4,
      Math.max(viewportLeft + half + 4, seriesX(index, series))),
    top: pointY < 155 ? pointY + 18 : pointY - 15,
    below: pointY < 155,
    width: tooltipWidth,
  }
}
function leavePlot() {
  hovered.value = null
  hoveredPoint.value = null
}
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
    const values = props.rows.flatMap((r) => series.map((s) => seriesValue(r, s))).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const min = Math.floor(Math.min(0, ...values))
    const max = Math.max(min + 1, Math.ceil(Math.max(1, ...values)))
    const top = 76 + index * 190
    return { ...band, series, top, min, max, y: (v: number) => top + 132 - ((v - min) / (max - min)) * 132 }
  }),
)
function toggle(key: string) {
  hidden.value = hidden.value.includes(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key]
}
function segments(s: OverviewSeries, y: (v: number) => number) {
  const groups: { x: number; y: number }[][] = []
  let points: { x: number; y: number }[] = []
  props.rows.forEach((row, i) => {
    const v = seriesValue(row, s)
    if (v == null) {
      if (points.length) groups.push(points)
      points = []
    } else points.push({ x: seriesX(i, s), y: y(v) })
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
      <button v-for="s in bands.flatMap((b) => b.series)" :key="s.key" :aria-pressed="!hidden.includes(s.key)" :class="{ muted: hidden.includes(s.key) }" @click="toggle(s.key)"><i :class="{ 'dash-swatch': s.dashed }" :style="{ background: s.dashed ? 'transparent' : s.color, borderColor: s.color }"></i>{{ s.label }}</button>
    </div>
    <div class="reading" aria-live="polite">
      <b>{{ focusDate }}</b
      ><span v-for="s in bands.flatMap((b) => b.series).filter((s) => !hidden.includes(s.key))" :key="s.key"
        ><i :class="{ 'dash-swatch': s.dashed }" :style="{ background: s.dashed ? 'transparent' : s.color, borderColor: s.color }"></i>{{ s.label }} <strong>{{ formatValue(focusRow ? seriesValue(focusRow, s) : null, s.key.includes('Premium')) }}</strong></span
      >
      <span v-if="focusRow"><i style="background: #e9be66"></i>全程一字板 <strong>{{ focusRow.oneWordCount }} 家<template v-if="focusRow.oneWordHighest"> · 最高 {{ focusRow.oneWordHighest }} 板</template></strong></span>
      <span v-if="focusRow?.heightUnknown">{{ focusRow.heightUnknown }} 家高度待判定</span>
    </div>
    <div v-if="selectedRow" class="height-stocks" aria-live="polite">
      <strong>{{ selectedRow.date }} 连板高度股票</strong>
      <span>最高 {{ formatValue(selectedRow.highest) }} 板：{{ names(selectedRow.highestStocks) }}</span>
      <span>次高 {{ formatValue(selectedRow.secondHighest) }} 板：{{ names(selectedRow.secondHighestStocks) }}</span>
      <span v-if="selectedOneWordTopTwo !== null">前二一字板 {{ selectedOneWordTopTwo }} 板：{{ names(selectedRow.oneWordStocks.filter((stock) => stock.boards === selectedOneWordTopTwo)) }}</span>
    </div>
    <p class="hint">横向滚动查看所有日期 · 悬停高度点查看股票名称 · 点击日期锁定明细 · 图例可隐藏指标</p>
    <div class="chart-body">
      <div class="band-index" aria-hidden="true">
        <span v-for="band in plotted" :key="band.title" :style="{ top: `${band.top - 20}px` }">{{ band.title }}<small>{{ band.unit }}</small></span>
      </div>
      <div ref="plot" class="scroll-plot" @mouseleave="leavePlot">
      <div class="plot-content" :style="{ width: `${width}px` }">
      <svg :viewBox="`0 0 ${width} 640`" :style="{ width: `${width}px` }" role="group" aria-label="数量、溢价和连板高度共享日期的组合图">
        <g v-for="(row, i) in rows" :key="row.date">
          <rect :x="70 + i * step" y="0" :width="step" height="32" :fill="row.date === focusDate ? '#668567' : '#284537'" stroke="#182a26" />
          <text :x="x(i)" y="21" text-anchor="middle" fill="#e1efdf">{{ row.date.slice(5).replace('-', '.') }}</text>
        </g>
        <g v-for="band in plotted" :key="band.title">
          <g v-for="v in [band.min, (band.min + band.max) / 2, band.max]" :key="v">
            <line x1="70" :x2="width - 14" :y1="band.y(v)" :y2="band.y(v)" stroke="#2e3948" stroke-dasharray="3 4" />
            <text x="58" :y="band.y(v) + 4" text-anchor="end" fill="#9cabbf">{{ Number(v.toFixed(1)) }}</text>
          </g>
          <line x1="70" :x2="width - 14" :y1="band.y(0)" :y2="band.y(0)" stroke="#607086" />
          <g v-for="s in band.series" :key="s.key">
            <template v-if="s.type !== 'bar'">
              <g v-for="(segment, i) in segments(s, band.y)" :key="i">
                <path v-if="s.type === 'area'" :d="segment.area" :fill="s.color" fill-opacity=".22" />
                <path :d="segment.line" fill="none" :stroke="s.color" stroke-width="2.5" :stroke-dasharray="s.dashed ? '7 5' : undefined" />
              </g>
            </template>
            <g v-for="(row, i) in rows" :key="row.date">
              <template v-if="seriesValue(row, s) != null">
                <rect v-if="s.type === 'bar'" :x="x(i) + (s.key === 'limitUp' ? -20 : 2)" :y="Math.min(band.y(seriesValue(row, s)!), band.y(0))" width="18" :height="Math.abs(band.y(seriesValue(row, s)!) - band.y(0))" :fill="s.color" fill-opacity=".75" rx="2" />
                <circle v-else :cx="seriesX(i, s)" :cy="band.y(seriesValue(row, s)!)" :r="s.type === 'line' ? 5 : 2.5" :fill="s.dashed ? 'transparent' : s.color" :stroke="s.dashed ? s.color : 'none'" :stroke-width="s.dashed ? 2 : 0" />
                <text v-if="labels" :x="seriesX(i, s) + (s.type === 'bar' ? (s.key === 'limitUp' ? -11 : 11) : 0)" :y="band.y(seriesValue(row, s)!) + (s.key === 'secondHighest' || s.key === 'consecutivePremium' ? 18 : s.dashed ? -21 : -9)" :fill="s.color" text-anchor="middle" class="value-label">{{ valueLabel(seriesValue(row, s), s) }}</text>
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
        <g v-for="band in plotted.filter((item) => item.title === '连板高度')" :key="`${band.title}-hit-points`">
          <template v-for="series in band.series" :key="series.key">
            <circle
              v-for="row in rows.filter((item) => seriesValue(item, series) !== null)"
              :key="`${series.key}-${row.date}`"
              :cx="seriesX(rows.findIndex((item) => item.date === row.date), series)"
              :cy="band.y(seriesValue(row, series)!)"
              r="9"
              fill="transparent"
              class="height-point-hit"
              tabindex="0"
              role="button"
              :aria-label="`${row.date} ${series.label} ${seriesValue(row, series)} 板：${names(pointStocks(row, series))}`"
              @mouseenter="showHeightPoint(row, rows.findIndex((item) => item.date === row.date), series, band.y)"
              @focus="showHeightPoint(row, rows.findIndex((item) => item.date === row.date), series, band.y)"
              @mouseleave="hoveredPoint = null"
              @blur="hoveredPoint = null"
              @click.stop="emit('select', row.date)"
              @keydown.enter.stop="emit('select', row.date)"
              @keydown.space.stop.prevent="emit('select', row.date)"
            />
          </template>
        </g>
      </svg>
      <div
        v-if="hoveredPoint"
        class="point-tooltip"
        :style="{
          left: `${hoveredPoint.left}px`,
          top: `${hoveredPoint.top}px`,
          width: `${hoveredPoint.width}px`,
          transform: hoveredPoint.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
        }"
        role="tooltip"
      >
        <strong>{{ hoveredPoint.date }} · {{ hoveredPoint.label }} {{ hoveredPoint.value }} 板</strong>
        <span>{{ names(hoveredPoint.stocks) }}</span>
      </div>
      </div>
      </div>
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
.dash-swatch {
  width: 16px;
  height: 0;
  border-top: 2px dashed;
  border-radius: 0;
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
.height-stocks {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 18px;
  padding: 12px;
  margin-top: 10px;
  border: 1px solid #33445a;
  border-radius: 8px;
  background: #ffffff07;
  color: #c5d1e2;
  font-size: 11px;
  line-height: 1.6;
}
.height-stocks strong { color: #eef3fb; }
.chart-body { display: flex; min-width: 0; }
.band-index {
  position: relative;
  flex: 0 0 102px;
  height: 640px;
  border-right: 1px solid #33445a;
  background: #17202d;
}
.band-index span {
  position: absolute;
  left: 8px;
  right: 8px;
  color: #cbd7e7;
  font-size: 10px;
  line-height: 1.4;
}
.band-index small { display: block; color: #8594ac; font-size: 10px; }
.scroll-plot {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-color: #64758b #17202d;
}
.plot-content { position: relative; height: 640px; }
.point-tooltip {
  position: absolute;
  z-index: 3;
  width: max-content;
  max-width: 270px;
  padding: 9px 11px;
  border: 1px solid #78869a;
  border-radius: 7px;
  background: #101b2b;
  box-shadow: 0 8px 22px #0008;
  color: #e8f0fa;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
}
.point-tooltip strong { display: block; margin-bottom: 3px; }
.point-tooltip span { display: block; white-space: normal; }
.height-point-hit { cursor: pointer; pointer-events: all; }
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
  .band-index { flex-basis: 78px; }
}
</style>
