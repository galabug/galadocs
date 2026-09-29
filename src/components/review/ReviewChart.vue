<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { formatValue } from '@/utils/review'
import type { ChartSeries, ReviewDay } from '@/types/review'

const props = defineProps<{
  title: string
  subtitle: string
  rows: ReviewDay[]
  series: ChartSeries[]
  unit: string
  selectedDate: string
}>()
const emit = defineEmits<{ select: [date: string] }>()
const id = useId().replace(/:/g, '')
const hidden = ref<string[]>([])
const hovered = ref<number | null>(null)
const visible = computed(() => props.series.filter((s) => !hidden.value.includes(s.key)))
const domain = computed(() => {
  const values = props.rows
    .flatMap((r) => visible.value.map((s) => r[s.key]))
    .filter((v): v is number => v !== null)
  const low = Math.min(0, ...values)
  const high = Math.max(1, ...values)
  const step = Math.max(props.unit === '%' ? 0.5 : 1, Math.ceil((high - low) / 4))
  return { min: Math.floor(low / step) * step, max: Math.ceil(high / step) * step, step }
})
const x = (index: number) => 48 + (index + 0.5) * (696 / Math.max(1, props.rows.length))
const y = (value: number) =>
  190 - ((value - domain.value.min) / (domain.value.max - domain.value.min)) * 166
const ticks = computed(() =>
  Array.from(
    { length: Math.round((domain.value.max - domain.value.min) / domain.value.step) + 1 },
    (_, i) => domain.value.min + domain.value.step * i,
  ),
)
const barSeries = computed(() => visible.value.filter((s) => s.type === 'bar'))
const barWidth = computed(() =>
  Math.max(1, ((696 / Math.max(1, props.rows.length)) * 0.7) / Math.max(1, barSeries.value.length)),
)
const inspected = computed(() => (hovered.value === null ? null : props.rows[hovered.value]))
const tickIndices = computed(() => [
  ...new Set(
    Array.from({ length: Math.min(6, props.rows.length) }, (_, i) =>
      Math.round((i * (props.rows.length - 1)) / Math.max(1, Math.min(6, props.rows.length) - 1)),
    ),
  ),
])

function segments(series: ChartSeries): { path: string; area: string }[] {
  const groups: { x: number; y: number }[][] = []
  let group: { x: number; y: number }[] = []
  for (let i = 0; i < props.rows.length; i++) {
    const value = props.rows[i]![series.key]
    if (value === null) {
      if (group.length) groups.push(group)
      group = []
    } else group.push({ x: x(i), y: y(value) })
  }
  if (group.length) groups.push(group)
  return groups.map((points) => {
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
    return {
      path,
      area: `${path} L${points[points.length - 1]!.x},${y(0)} L${points[0]!.x},${y(0)} Z`,
    }
  })
}
function toggle(key: string) {
  hidden.value = hidden.value.includes(key)
    ? hidden.value.filter((k) => k !== key)
    : [...hidden.value, key]
}
</script>

<template>
  <section class="chart-panel">
    <div class="chart-heading">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
      <span class="unit">{{ unit === '%' ? '等权平均 · %' : `单位：${unit}` }}</span>
    </div>
    <div class="legend">
      <button
        v-for="s in series"
        :key="s.key"
        :class="{ muted: hidden.includes(s.key) }"
        :aria-pressed="!hidden.includes(s.key)"
        @click="toggle(s.key)"
      >
        <i :style="{ background: s.color }"></i>{{ s.label }}
      </button>
    </div>
    <div class="plot" @mouseleave="hovered = null">
      <svg viewBox="0 0 768 226" role="group" :aria-label="`${title}，可点击或用键盘选择日期`">
        <defs>
          <linearGradient
            v-for="s in series"
            :id="`${id}-${s.key}`"
            :key="s.key"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" :stop-color="s.color" stop-opacity=".24" />
            <stop offset="100%" :stop-color="s.color" stop-opacity=".015" />
          </linearGradient>
        </defs>
        <g v-for="tick in ticks" :key="tick">
          <line
            x1="48"
            x2="744"
            :y1="y(tick)"
            :y2="y(tick)"
            stroke="#283141"
            stroke-dasharray="3 5"
          />
          <text x="35" :y="y(tick) + 4" text-anchor="end">{{ Number(tick.toFixed(1)) }}</text>
        </g>
        <line v-if="domain.min < 0" x1="48" x2="744" :y1="y(0)" :y2="y(0)" stroke="#5a6479" />
        <g v-for="(s, seriesIndex) in barSeries" :key="s.key">
          <rect
            v-for="(row, i) in rows"
            :key="row.date"
            :x="x(i) - (barWidth * barSeries.length) / 2 + seriesIndex * barWidth"
            :y="Math.min(y(row[s.key] ?? 0), y(0))"
            :width="Math.max(0.5, barWidth - 1)"
            :height="Math.abs(y(row[s.key] ?? 0) - y(0))"
            rx="1.5"
            :fill="s.color"
            fill-opacity=".85"
          />
        </g>
        <g v-for="s in visible.filter((item) => item.type !== 'bar')" :key="s.key">
          <g v-for="(segment, i) in segments(s)" :key="i">
            <path v-if="s.type === 'area'" :d="segment.area" :fill="`url(#${id}-${s.key})`" />
            <path
              :d="segment.path"
              fill="none"
              :stroke="s.color"
              stroke-width="2.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
          <template v-for="(row, i) in rows" :key="row.date">
            <circle
              v-if="row[s.key] !== null"
              :cx="x(i)"
              :cy="y(row[s.key]!)"
              :r="row.date === selectedDate ? 3.5 : 1.6"
              :fill="s.color"
            />
          </template>
        </g>
        <text v-for="i in tickIndices" :key="i" :x="x(i)" y="216" text-anchor="middle">
          {{ rows[i]?.date.slice(5).replace('-', '/') }}
        </text>
        <template v-for="(row, i) in rows" :key="row.date">
          <line
            v-if="row.date === selectedDate || i === hovered"
            :x1="x(i)"
            :x2="x(i)"
            y1="18"
            y2="192"
            stroke="#9aa8c0"
            stroke-opacity=".5"
            stroke-dasharray="3 4"
          />
          <rect
            :x="48 + (i * 696) / rows.length"
            y="10"
            :width="696 / rows.length"
            height="188"
            fill="transparent"
            tabindex="0"
            role="button"
            :aria-label="`查看 ${row.date}`"
            @mouseenter="hovered = i"
            @focus="hovered = i"
            @blur="hovered = null"
            @click="emit('select', row.date)"
            @keydown.enter="emit('select', row.date)"
            @keydown.space.prevent="emit('select', row.date)"
          />
        </template>
      </svg>
      <div
        v-if="inspected"
        class="tooltip"
        :style="{ left: `${Math.min(69, Math.max(8, ((hovered! + 0.5) / rows.length) * 90))}%` }"
      >
        <strong>{{ inspected.date }}</strong>
        <span v-for="s in visible" :key="s.key"
          ><i :style="{ background: s.color }"></i>{{ s.label
          }}<b>{{ formatValue(inspected[s.key], unit === '%') }}</b></span
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.chart-panel {
  min-width: 0;
  padding: 24px 22px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
}
.chart-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px;
  letter-spacing: 0.3px;
}
p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}
.unit {
  white-space: nowrap;
  font-size: 10px;
  color: var(--muted);
  padding-top: 3px;
}
.legend {
  display: flex;
  gap: 18px;
  margin: 21px 0 6px;
  min-height: 19px;
}
.legend button {
  padding: 0;
  border: 0;
  background: none;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: #aeb9cb;
}
i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.legend .muted {
  opacity: 0.35;
}
.plot {
  position: relative;
}
svg {
  display: block;
  width: 100%;
  overflow: visible;
}
svg text {
  fill: #758299;
  font-size: 11px;
  font-family: inherit;
}
svg [role='button'] {
  cursor: crosshair;
}
.tooltip {
  position: absolute;
  top: 5%;
  z-index: 2;
  pointer-events: none;
  padding: 12px;
  border: 1px solid #47516a;
  border-radius: 8px;
  background: #1b2435f5;
  box-shadow: 0 5px 24px #0005;
  font-size: 11px;
  min-width: 148px;
}
.tooltip strong {
  display: block;
  margin-bottom: 9px;
}
.tooltip span {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 5px 0;
  white-space: nowrap;
}
.tooltip b {
  margin-left: auto;
}
@media (max-width: 600px) {
  .chart-panel {
    padding: 20px 12px 12px;
  }
  .chart-heading {
    padding: 0 6px;
  }
  .legend {
    padding: 0 6px;
  }
  svg text {
    font-size: 14px;
  }
}
</style>
