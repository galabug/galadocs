<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ReviewChart from '@/components/review/ReviewChart.vue'
import { formatValue, parseReview, parseSourceHealth, sourceLabel } from '@/utils/review'
import type { ChartSeries, Metric, ReviewData, ReviewDay, SourceHealth } from '@/types/review'

const data = ref<ReviewData | null>(null)
const source = ref<ReviewData['source']>('free')
const sourceHealth = ref<SourceHealth[]>([])
const sourceError = ref('')
const selectedDate = ref('')
const windowSize = ref(40)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const showGuide = ref(false)
const section = ref('overview')
const rows = computed(() => (data.value?.rows ?? []).slice(-windowSize.value))
const selected = computed(
  () => rows.value.find((r) => r.date === selectedDate.value) ?? rows.value[rows.value.length - 1],
)
const previous = computed(() => {
  const all = data.value?.rows ?? []
  return all[all.findIndex((r) => r.date === selected.value?.date) - 1]
})
const dateLabel = computed(() => selected.value?.date.replace(/-/g, '.') ?? '等待数据')
const counts: ChartSeries[] = [
  { key: 'limitUp', label: '涨停家数', color: '#ff6a7a', type: 'bar' },
  { key: 'limitDown', label: '跌停家数', color: '#40cba2', type: 'bar' },
]
const streaks: ChartSeries[] = [
  { key: 'consecutive', label: '连板家数', color: '#7896ff', type: 'area' },
]
const premiums: ChartSeries[] = [
  { key: 'upPremium', label: '昨日涨停溢价', color: '#ffb86c', type: 'line' },
  { key: 'consecutivePremium', label: '昨日连板溢价', color: '#a694ff', type: 'line' },
]
const heights: ChartSeries[] = [
  { key: 'highest', label: '最高连板', color: '#7896ff', type: 'line' },
  { key: 'lowest', label: '最低连板', color: '#40cba2', type: 'line' },
]
const cards = [
  { key: 'limitUp', label: '涨停家数', unit: '家', color: 'red', tag: 'UP' },
  { key: 'limitDown', label: '跌停家数', unit: '家', color: 'green', tag: 'DOWN' },
  { key: 'consecutive', label: '连板家数', unit: '家', color: 'blue', tag: 'STREAK' },
  { key: 'upPremium', label: '昨日涨停溢价', unit: '', color: 'amber', tag: 'RETURN' },
  { key: 'consecutivePremium', label: '昨日连板溢价', unit: '', color: 'purple', tag: 'RETURN' },
  { key: 'highest', label: '最高 / 最低连板', unit: '板', color: 'blue', tag: 'HEIGHT' },
] as const

async function load(
  nextSource: 'demo' | 'live' = source.value === 'demo' ? 'demo' : 'live',
  allowDemoFallback = false,
) {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const filename = nextSource === 'demo' ? 'review-demo.json' : 'review.json'
    const response = await fetch(`${import.meta.env.BASE_URL}data/${filename}`, {
      cache: 'no-store',
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
      if (
        allowDemoFallback &&
        (response.status === 404 ||
          (response.ok && response.headers.get('content-type')?.includes('text/html')))
      ) {
        await load('demo')
        notice.value =
          '尚未生成真实数据，当前为示例。运行 npm run review:collect 即可免费采集，无需账号。'
        return
      }
      throw new Error(
        nextSource !== 'demo'
          ? '尚无真实数据。请运行 npm run review:collect，默认使用免费数据源，无需账号。'
          : '示例数据读取失败，请运行 npm run review:demo。',
      )
    }
    const result = parseReview(await response.json())
    if ((result.source === 'demo') !== (nextSource === 'demo'))
      throw new Error('数据来源标识不匹配，已停止加载。')
    data.value = result
    source.value = result.source
    selectedDate.value = result.rows[result.rows.length - 1]!.date
    notice.value =
      nextSource === 'demo'
        ? '已读取 40 日模拟数据；日期与指标仅用于界面演示。'
        : `已读取 ${result.rows.length} 个真实交易日。${result.notice ?? '网页刷新不会触发后台采集。'}`
    if (result.sources) sourceHealth.value = parseSourceHealth(result.sources)
    await loadSourceHealth()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}
function changeWindow(value: number) {
  windowSize.value = value
  if (!rows.value.some((row) => row.date === selectedDate.value))
    selectedDate.value = rows.value[rows.value.length - 1]?.date ?? ''
}
function delta(key: Metric) {
  const current = selected.value?.[key]
  const prior = previous.value?.[key]
  if (current == null || prior == null) return '暂无前日对比'
  const diff = current - prior
  const percent = key.includes('Premium')
  return `${diff > 0 ? '+' : ''}${percent ? diff.toFixed(2) : diff}${percent ? ' 个百分点' : key === 'highest' ? ' 板' : ' 家'} 较前日`
}
function sparkline(key: Metric) {
  const end = rows.value.findIndex((r) => r.date === selected.value?.date)
  const values = rows.value.slice(Math.max(0, end - 15), end + 1).map((r) => r[key])
  const valid = values.filter((v): v is number => v !== null)
  const min = Math.min(...valid),
    max = Math.max(...valid)
  let gap = true
  return values
    .map((v, i) => {
      if (v === null) {
        gap = true
        return ''
      }
      const command = gap ? 'M' : 'L'
      gap = false
      return `${command}${(i * 140) / Math.max(1, values.length - 1)},${26 - ((v - min) / Math.max(1, max - min)) * 23}`
    })
    .join(' ')
}
function exportCsv() {
  if (!rows.value.length) return
  const header = [
    '日期',
    '涨停家数',
    '跌停家数',
    '连板家数',
    '昨日涨停溢价(%)',
    '昨日连板溢价(%)',
    '最高连板',
    '最低连板',
    '涨停溢价有效样本',
    '连板溢价有效样本',
    '涨停溢价剔除样本',
    '连板溢价剔除样本',
  ]
  const keys: (keyof ReviewDay)[] = [
    'date',
    'limitUp',
    'limitDown',
    'consecutive',
    'upPremium',
    'consecutivePremium',
    'highest',
    'lowest',
    'upSamples',
    'consecutiveSamples',
    'upExcluded',
    'consecutiveExcluded',
  ]
  const csv =
    '\uFEFF' +
    [
      header.join(','),
      ...rows.value.map((row) => keys.map((key) => row[key] ?? '').join(',')),
    ].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `盘后复盘-${source.value}-${rows.value[rows.value.length - 1]!.date}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function navigate(target: string) {
  section.value = target
  document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
async function loadSourceHealth() {
  sourceError.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/sources.json`, {
      cache: 'no-store',
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
      sourceError.value = '尚无检测记录；运行 npm run review:sources 检测免费来源。'
      return
    }
    const result = await response.json()
    sourceHealth.value = parseSourceHealth(result.sources)
  } catch {
    sourceError.value = '数据源检测记录读取失败，保留上次状态。'
  }
}
onMounted(async () => {
  await load('live', true)
  await loadSourceHealth()
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="navigate('overview')"
        ><span class="brand-mark">▥</span><span>收盘之后<small>AFTER THE BELL</small></span></a
      >
      <div class="workspace-label">研究工作台</div>
      <nav aria-label="主导航">
        <button :class="{ active: section === 'overview' }" @click="navigate('overview')">
          <span>◫</span>市场复盘 <b>01</b>
        </button>
        <button :class="{ active: section === 'history' }" @click="navigate('history')">
          <span>▤</span>历史数据
        </button>
        <button :class="{ active: section === 'method' }" @click="navigate('method')">
          <span>⌘</span>指标口径
        </button>
        <button @click="showGuide = !showGuide"><span>⚙</span>采集配置</button>
      </nav>
      <div class="sidebar-bottom">
        <div class="market-label"><i></i>沪深 A 股主板</div>
        <p>让每个交易日，有迹可循。</p>
        <div class="version">
          <span class="avatar">研</span><span>个人量化工作台<small>本地数据 · v1.0</small></span>
        </div>
      </div>
    </aside>

    <div class="main-shell">
      <header class="topbar">
        <div><span class="crumb">工作台</span><span class="separator">/</span>市场复盘</div>
        <div class="topbar-right">
          <span class="status-dot"></span>盘后研究<span class="divider"></span
          ><span class="avatar small">研</span>
        </div>
      </header>
      <main id="overview">
        <div class="page-heading">
          <div>
            <div class="eyebrow">MARKET REVIEW <span>/</span> 每日市场情绪观察</div>
            <h1>盘后复盘<span class="badge">主板 · 非 ST</span></h1>
            <p>从涨跌停、连板与次日溢价，回看市场情绪的变化。</p>
          </div>
          <div class="heading-actions">
            <button class="secondary" @click="showGuide = !showGuide">⚙ 采集配置</button
            ><button class="primary" :disabled="loading" @click="load()">
              <span>↻</span> {{ loading ? '读取中…' : '刷新数据' }}
            </button>
          </div>
        </div>

        <div class="source-banner" :class="{ live: source !== 'demo' && !!data }">
          <span class="source-icon">{{ source === 'demo' ? '◈' : '✓' }}</span>
          <div>
            <strong>{{
              !data
                ? '等待数据'
                : source === 'demo'
                  ? '示例模式'
                  : source === 'free'
                    ? '真实采集数据 · 无需账号'
                    : '真实采集数据'
            }}</strong
            ><span>{{
              source === 'demo'
                ? '当前为模拟数据，仅演示指标和图表，不代表真实行情。'
                : `来源：${sourceLabel(selected?.poolSource ?? source)} · 最后采集 ${data?.generatedAt}`
            }}</span>
          </div>
          <button :disabled="loading" @click="load(source === 'demo' ? 'live' : 'demo')">
            {{ source === 'demo' ? '读取真实数据' : '切换示例' }} <span>→</span>
          </button>
        </div>
        <p v-if="error" role="alert" class="error">
          {{ error }}<button @click="showGuide = true">查看配置步骤 →</button>
        </p>
        <p v-if="notice" role="status" class="notice">{{ notice }}</p>

        <section v-if="showGuide" class="guide">
          <div class="section-heading">
            <h2>配置一次，每天盘后运行</h2>
            <button class="secondary" @click="showGuide = false">收起</button>
          </div>
          <ol>
            <li>
              <b>免费采集</b><code>npm run review:collect</code
              ><span>默认 BaoStock 主源、东方财富近期备用，无需 Token。</span>
            </li>
            <li>
              <b>检查备用来源</b><code>npm run review:sources</code
              ><span>检测 BaoStock、东方财富、腾讯、新浪，结果显示在页面。</span>
            </li>
            <li>
              <b>每天更新</b><code>每天 18:30 · 北京时间</code
              ><span>定时任务在 Codex 或系统调度器中管理；页面本身不执行采集。</span>
            </li>
          </ol>
          <p>
            首次回溯 40 个交易日；后续补齐缺失日期、重算最近 3
            日、保留全部历史。生产部署须同步生成的 JSON 或重新构建。
          </p>
        </section>

        <section class="sources-panel" aria-label="免费数据源状态">
          <div class="sources-heading">
            <strong>免费数据源</strong><span>完整复盘与行情备用按能力切换</span
            ><button @click="loadSourceHealth">重新读取检测结果 ↻</button>
          </div>
          <p v-if="sourceError" class="notice">{{ sourceError }}</p>
          <div class="sources-grid">
            <article v-for="item in sourceHealth" :key="item.id" :class="item.status">
              <div>
                <strong>{{ item.name }}</strong
                ><span>{{
                  item.status === 'ok'
                    ? '检测通过'
                    : item.status === 'unavailable'
                      ? '暂不可用'
                      : '尚未检测'
                }}</span>
              </div>
              <p>{{ item.capability }}</p>
              <small>{{ item.detail }}</small>
              <time v-if="item.checkedAt"
                >检测于 {{ item.checkedAt.slice(0, 19).replace('T', ' ') }}</time
              >
            </article>
          </div>
          <p v-if="selected?.poolSource" class="source-provenance">
            当前日期：股池 {{ sourceLabel(selected.poolSource) }} · 溢价
            {{ sourceLabel(selected.quoteSource)
            }}<span v-if="selected.method"> · {{ selected.method }}</span>
          </p>
        </section>

        <div class="toolbar">
          <div class="date-control">
            <span class="calendar-icon">▦</span><label for="review-date">复盘日期</label
            ><select id="review-date" v-model="selectedDate" :disabled="!rows.length">
              <option v-for="row in [...rows].reverse()" :key="row.date" :value="row.date">
                {{ row.date }}
              </option></select
            ><span class="date-tag">{{ source === 'demo' ? '示意' : '收盘' }}</span>
          </div>
          <div class="range-control">
            <span>观察区间</span>
            <div class="segments">
              <button
                v-for="n in [20, 40, 60]"
                :key="n"
                :class="{ chosen: windowSize === n }"
                :aria-pressed="windowSize === n"
                @click="changeWindow(n)"
              >
                {{ n }} 日
              </button>
            </div>
            <button class="export-button" :disabled="!rows.length" @click="exportCsv">
              ↓ 导出
            </button>
          </div>
        </div>

        <div v-if="selected" class="metrics-grid">
          <article v-for="card in cards" :key="card.key" class="metric-card" :class="card.color">
            <div class="metric-label">
              {{ card.label }}<span>{{ card.tag }}</span>
            </div>
            <div class="metric-value">
              {{ formatValue(selected[card.key], card.key.includes('Premium'))
              }}<template v-if="card.key === 'highest'"
                ><span class="slash">/</span>{{ formatValue(selected.lowest) }}</template
              ><small>{{ card.unit }}</small>
            </div>
            <div class="metric-footer">
              <span>{{ delta(card.key) }}</span
              ><svg viewBox="0 0 140 30" aria-hidden="true">
                <path :d="sparkline(card.key)" fill="none" stroke="currentColor" stroke-width="2" />
              </svg>
            </div>
          </article>
        </div>

        <div class="charts-heading">
          <h2>
            市场情绪全景
            <span>{{ rows.length }} {{ source === 'demo' ? '个示例日期' : '个交易日' }}</span>
          </h2>
          <span>点击图表选择日期 · 点击图例切换指标</span>
        </div>
        <div v-if="rows.length" class="charts-grid">
          <ReviewChart
            title="涨跌停家数"
            subtitle="涨停与跌停的分布，观察情绪扩散"
            :rows="rows"
            :series="counts"
            unit="家"
            :selected-date="selectedDate"
            @select="selectedDate = $event"
          />
          <ReviewChart
            title="连板家数"
            subtitle="连续 2 板及以上，观察接力活跃度"
            :rows="rows"
            :series="streaks"
            unit="家"
            :selected-date="selectedDate"
            @select="selectedDate = $event"
          />
          <ReviewChart
            title="昨日强势股 · 今日溢价"
            subtitle="昨日涨停与连板股票，今日收盘的平均表现"
            :rows="rows"
            :series="premiums"
            unit="%"
            :selected-date="selectedDate"
            @select="selectedDate = $event"
          />
          <ReviewChart
            title="连板高度"
            subtitle="最高与最低连板，观察市场接力空间"
            :rows="rows"
            :series="heights"
            unit="板"
            :selected-date="selectedDate"
            @select="selectedDate = $event"
          />
        </div>
        <div v-else class="empty">
          {{ loading ? '正在读取复盘数据…' : '暂无数据，请生成示例或运行采集器。' }}
        </div>

        <section v-if="selected" class="sample-strip">
          <div>
            <span class="sample-icon">◎</span><strong>{{ dateLabel }} <span>溢价样本</span></strong>
          </div>
          <span
            >昨日涨停 <b>{{ selected.upSamples }}</b> 家有效 ·
            {{ selected.upExcluded }} 家剔除</span
          ><span
            >昨日连板 <b>{{ selected.consecutiveSamples }}</b> 家有效 ·
            {{ selected.consecutiveExcluded }} 家剔除</span
          ><span class="sample-note">缺行情 / 当日 ST 不计入均值</span>
        </section>

        <section id="history" class="history-panel">
          <div class="section-heading">
            <div>
              <h2>每日数据明细</h2>
              <p>
                {{ rows[0]?.date }} — {{ rows[rows.length - 1]?.date }} · 当前窗口
                {{ rows.length }} 条 / 已存 {{ data?.rows.length ?? 0 }} 条
              </p>
            </div>
            <button class="secondary" :disabled="!rows.length" @click="exportCsv">
              ↓ 导出 CSV
            </button>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>涨停家数</th>
                  <th>跌停家数</th>
                  <th>连板家数</th>
                  <th>昨日涨停溢价</th>
                  <th>昨日连板溢价</th>
                  <th>最高 / 最低连板</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in [...rows].reverse()"
                  :key="row.date"
                  :class="{ selected: row.date === selectedDate }"
                >
                  <td>
                    <button @click="selectedDate = row.date">
                      {{ row.date }}<i v-if="row.date === selectedDate"></i>
                    </button>
                  </td>
                  <td class="red">{{ row.limitUp }}</td>
                  <td class="green">{{ row.limitDown }}</td>
                  <td>{{ row.consecutive }}</td>
                  <td :class="(row.upPremium ?? 0) >= 0 ? 'red' : 'green'">
                    {{ formatValue(row.upPremium, true) }}
                  </td>
                  <td :class="(row.consecutivePremium ?? 0) >= 0 ? 'red' : 'green'">
                    {{ formatValue(row.consecutivePremium, true) }}
                  </td>
                  <td>
                    {{ formatValue(row.highest) }} <span class="slash">/</span>
                    {{ formatValue(row.lowest) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="method" class="method-panel">
          <div class="section-heading">
            <h2>指标口径</h2>
            <span>统一口径，让每天的数据可比较</span>
          </div>
          <div class="method-grid">
            <div>
              <h3>01 <span>统计范围</span></h3>
              <p>
                沪深 A 股主板；按历史当日 ST 标记剔除 ST / *ST。不包含创业板、科创板、北交所和 B
                股。
              </p>
            </div>
            <div>
              <h3>02 <span>涨跌停与连板</span></h3>
              <p>
                BaoStock 按主板 10% 价格规则推算收盘封板，排除注册制 IPO 前 5
                日，向前追溯连板。特殊重新上市不设限日需核对；股池备用源采用其连板统计。无连板显示空值。
              </p>
            </div>
            <div>
              <h3>03 <span>昨日股票的今日溢价</span></h3>
              <p>
                以前一交易日股票池为基础，等权平均（今日收盘 ÷ 除权昨收 − 1）× 100%。剔除当日
                ST、停牌或缺行情，显示有效及剔除样本数；无样本显示“—”。
              </p>
            </div>
            <div>
              <h3>04 <span>历史与更新</span></h3>
              <p>
                首次额外取前一交易日作为溢价基准，展示最近 40
                个交易日。真实采集以交易所日历为准，自动跳过休市日，按日期去重并补齐漏跑日期。
              </p>
            </div>
          </div>
        </section>
        <footer>
          <span class="footer-brand">收盘之后 <span>/</span> AFTER THE BELL</span
          ><span
            >数据记录与研究工具 ·
            {{
              source === 'demo'
                ? '当前为模拟行情'
                : `当日来源：${sourceLabel(selected?.poolSource ?? source)}`
            }}</span
          >
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.sources-panel {
  margin-top: 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  background: #111823;
}
.sources-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 11px;
}
.sources-heading strong {
  font-weight: 500;
}
.sources-heading span {
  color: #77869d;
  font-size: 10px;
}
.sources-heading button {
  margin-left: auto;
  border: 0;
  background: none;
  color: #9caee1;
  font-size: 10px;
}
.sources-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 14px;
}
.sources-grid article {
  border: 1px solid #2b3547;
  padding: 12px;
  border-radius: 6px;
  min-width: 0;
}
.sources-grid article > div {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
}
.sources-grid article > div span {
  color: #8c9ab0;
  font-size: 9px;
}
.sources-grid article.ok > div span {
  color: #40cba2;
}
.sources-grid article.unavailable > div span {
  color: #e9b57b;
}
.sources-grid p {
  color: #8898b1;
  line-height: 1.7;
  font-size: 10px;
  margin: 10px 0 6px;
}
.sources-grid small {
  color: #6f7f98;
  font-size: 9px;
  line-height: 1.6;
  display: block;
  overflow-wrap: anywhere;
}
.sources-grid time {
  color: #546681;
  display: block;
  font-size: 9px;
  margin-top: 8px;
}
.source-provenance {
  color: #8493ad;
  font-size: 10px;
  line-height: 1.7;
  margin: 13px 0 0;
}
@media (max-width: 1100px) {
  .sources-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 600px) {
  .sources-heading {
    flex-wrap: wrap;
  }
  .sources-heading span {
    display: none;
  }
  .sources-grid {
    grid-template-columns: 1fr;
  }
}

.app-shell {
  min-height: 100vh;
}
.sidebar {
  width: 208px;
  position: fixed;
  inset: 0 auto 0 0;
  background: #101620;
  border-right: 1px solid var(--border);
  padding: 32px 19px;
  display: flex;
  flex-direction: column;
  z-index: 5;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 7px;
  font-size: 19px;
  letter-spacing: 1.5px;
  font-weight: 650;
}
.brand-mark {
  color: #9aacff;
  border: 1px solid #6376c5;
  border-radius: 8px;
  background: #283357;
  font-size: 27px;
  padding: 1px 7px 3px;
}
.brand small {
  display: block;
  font-size: 8px;
  letter-spacing: 1.9px;
  color: #6f7e96;
  margin-top: 6px;
  font-weight: 500;
}
.workspace-label {
  font-size: 10px;
  letter-spacing: 1px;
  color: #59657a;
  margin: 47px 14px 17px;
}
nav {
  display: grid;
  gap: 8px;
}
nav button {
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  padding: 13px 14px;
  text-align: left;
  color: #8f9bb0;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 13px;
}
nav button > span {
  font-size: 18px;
  width: 18px;
}
nav button b {
  font-size: 10px;
  margin-left: auto;
  font-weight: 400;
  color: #aab9ff;
}
nav button.active {
  color: #b3c1ff;
  background: #202c48;
  border-color: #2e3d60;
}
nav button:hover {
  color: #dce3f7;
}
.sidebar-bottom {
  margin-top: auto;
  padding: 16px 7px 0;
}
.market-label {
  font-size: 11px;
  color: #a0adbf;
  display: flex;
  align-items: center;
  gap: 7px;
}
.market-label i,
.status-dot {
  background: #40cba2;
  width: 5px;
  height: 5px;
  display: inline-block;
  border-radius: 50%;
}
.sidebar-bottom p {
  font-size: 10px;
  color: #576479;
  margin: 12px 0 25px;
}
.version {
  border-top: 1px solid var(--border);
  padding-top: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.version small {
  color: #6a768c;
  display: block;
  font-size: 9px;
  margin-top: 5px;
}
.avatar {
  background: #263047;
  color: #aebddd;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
}
.avatar.small {
  width: 27px;
  height: 27px;
  font-size: 10px;
}
.main-shell {
  margin-left: 208px;
}
.topbar {
  height: 65px;
  border-bottom: 1px solid #1c2532;
  padding: 0 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #bcc6d6;
}
.crumb {
  color: #6d7990;
}
.separator {
  margin: 0 17px;
  color: #485469;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #8a97ac;
  font-size: 10px;
}
.divider {
  width: 1px;
  height: 16px;
  background: #30394b;
  margin: 0 12px;
}
main {
  max-width: 1740px;
  margin: 0 auto;
  padding: 35px 36px 0;
  scroll-margin-top: 20px;
}
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 25px;
}
.eyebrow {
  font-size: 9px;
  color: #7c8aab;
  letter-spacing: 1.6px;
}
.eyebrow span {
  margin: 0 10px;
  color: #41506c;
}
h1 {
  font-size: 28px;
  letter-spacing: 1px;
  font-weight: 600;
  margin: 12px 0 10px;
  display: flex;
  gap: 15px;
  align-items: center;
}
.badge {
  font-size: 10px;
  color: #9fb2dc;
  border: 1px solid #33415c;
  padding: 5px 8px;
  border-radius: 4px;
  font-weight: 400;
  letter-spacing: 0.2px;
}
.page-heading p {
  font-size: 11px;
  color: var(--muted);
  margin: 0;
}
.heading-actions {
  display: flex;
  gap: 9px;
}
.primary,
.secondary {
  border: 1px solid #2e394c;
  border-radius: 6px;
  padding: 9px 14px;
  font-size: 11px;
  background: #18202d;
  white-space: nowrap;
}
.primary {
  background: #7896ff;
  color: #101a35;
  border-color: #7896ff;
  font-weight: 600;
}
.primary span {
  font-size: 15px;
  margin-right: 4px;
}
.secondary:hover {
  background: #242f43;
}
.source-banner {
  background: #1e1d20;
  border: 1px solid #3f352a;
  border-radius: 7px;
  padding: 12px 15px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.source-banner.live {
  background: #10251f;
  border-color: #234c3b;
}
.source-icon {
  color: #d5a96c;
  font-size: 18px;
}
.source-banner strong {
  color: #d9b37d;
  font-size: 11px;
  margin-right: 15px;
}
.source-banner div > span {
  color: #9c968d;
  font-size: 11px;
}
.source-banner button {
  margin-left: auto;
  background: none;
  border: none;
  white-space: nowrap;
  font-size: 11px;
  color: #d9b37d;
}
.source-banner button span {
  margin-left: 12px;
}
.notice {
  font-size: 10px;
  color: #77869c;
  margin: 10px 0 0;
}
.error {
  padding: 14px;
  border: 1px solid #723b44;
  border-radius: 7px;
  background: #331f27;
  font-size: 12px;
  color: #ffa3ad;
}
.error button {
  margin-left: 15px;
  border: 0;
  background: none;
  color: #b5c5ff;
  font-size: 11px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 25px 0 19px;
  gap: 16px;
}
.date-control,
.range-control {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 11px;
  color: #8c9ab0;
}
.calendar-icon {
  font-size: 20px;
  color: #98a8c5;
}
.date-control select {
  padding: 7px 9px;
  border: 1px solid #303b4d;
  border-radius: 5px;
  background: #17202e;
  color: #e3e9f3;
  font-size: 11px;
  color-scheme: dark;
}
.date-tag {
  border-radius: 3px;
  font-size: 9px;
  color: #8e9eb9;
  background: #202837;
  padding: 3px 5px;
}
.segments {
  display: flex;
  padding: 3px;
  background: #151d29;
  border: 1px solid #273145;
  border-radius: 6px;
  gap: 2px;
}
.segments button {
  background: none;
  border: 0;
  padding: 6px 11px;
  color: #76849b;
  font-size: 10px;
  border-radius: 4px;
}
.segments .chosen {
  background: #2a3752;
  color: #c4d0f7;
}
.export-button {
  padding: 7px 3px 7px 10px;
  color: #9aabc6;
  font-size: 11px;
  background: none;
  border: none;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
.metric-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 17px 15px 13px;
  overflow: hidden;
}
.metric-label {
  color: #9aa7bc;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 3px;
}
.metric-label > span {
  font-size: 7px;
  color: #57647b;
  letter-spacing: 0.8px;
}
.metric-value {
  font-size: clamp(22px, 2.1vw, 33px);
  font-weight: 550;
  margin: 16px 0 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.8px;
  white-space: nowrap;
}
.metric-value small {
  font-size: 10px;
  color: #718099;
  margin-left: 7px;
  font-weight: 400;
}
.slash {
  color: #5b6981;
  margin: 0 5px;
  font-size: 0.75em;
}
.metric-footer {
  position: relative;
  min-height: 27px;
  display: flex;
  align-items: flex-end;
}
.metric-footer > span {
  color: #718098;
  font-size: 8px;
  position: relative;
  z-index: 1;
  white-space: nowrap;
}
.metric-footer svg {
  position: absolute;
  right: -4px;
  bottom: 12px;
  width: 65%;
  height: 24px;
  opacity: 0.35;
}
.red {
  color: var(--red);
}
.green {
  color: var(--green);
}
.blue {
  color: var(--blue);
}
.amber {
  color: #ffb86c;
}
.purple {
  color: #b29aff;
}
.charts-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 30px 0 15px;
}
.charts-heading h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.charts-heading h2 span {
  font-size: 10px;
  color: #76869d;
  margin-left: 11px;
}
.charts-heading > span {
  font-size: 10px;
  color: #5f6e86;
}
.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 17px;
}
.sample-strip {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 16px;
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 25px;
  color: #8190a6;
  font-size: 10px;
  background: #101722;
}
.sample-strip > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sample-strip strong {
  color: #b0bed4;
  font-size: 11px;
  font-weight: 500;
}
.sample-strip strong span {
  color: #657690;
  font-weight: 400;
  margin-left: 7px;
}
.sample-strip b {
  color: #c4cfe1;
  font-weight: 500;
}
.sample-icon {
  color: #8da4d5;
  font-size: 20px;
}
.sample-note {
  margin-left: auto;
  color: #5e6d84;
}
.history-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-top: 27px;
  scroll-margin-top: 22px;
  overflow: hidden;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 22px;
}
.section-heading h2 {
  font-size: 14px;
  font-weight: 500;
  margin: 0;
}
.section-heading p {
  font-size: 10px;
  color: #728199;
  margin: 8px 0 0;
}
.section-heading > span {
  font-size: 10px;
  color: #62718a;
}
.table-scroll {
  max-height: 343px;
  overflow: auto;
  scrollbar-color: #394761 #131a25;
  scrollbar-width: thin;
}
table {
  border-collapse: collapse;
  width: 100%;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
th {
  position: sticky;
  top: 0;
  background: #192231;
  z-index: 1;
  color: #7e8da6;
  font-weight: 400;
  font-size: 10px;
  padding: 13px 20px;
  text-align: right;
}
td {
  padding: 13px 20px;
  border-bottom: 1px solid #202938;
  font-size: 11px;
  text-align: right;
}
th:first-child,
td:first-child {
  text-align: left;
}
tr.selected {
  background: #1d2a40;
}
tr:hover {
  background: #1b2638;
}
td button {
  color: #b5c3d9;
  font-size: 11px;
  border: 0;
  background: none;
  padding: 0;
}
td i {
  display: inline-block;
  background: #89a1ff;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  margin-left: 8px;
}
.method-panel {
  margin-top: 26px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #111823;
  scroll-margin-top: 20px;
}
.method-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 26px;
  padding: 0 22px 22px;
}
.method-grid h3 {
  color: #6680b8;
  font-size: 11px;
  font-weight: 500;
}
.method-grid h3 span {
  color: #9aaac4;
  margin-left: 9px;
}
.method-grid p {
  color: #6e7d94;
  font-size: 10px;
  line-height: 1.9;
  margin: 0;
}
.guide {
  border: 1px solid #394765;
  background: #192233;
  border-radius: 8px;
  margin-top: 18px;
}
.guide ol {
  margin: 0;
  padding: 0 24px 0 42px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px;
  font-size: 11px;
}
.guide li b {
  display: block;
  margin-bottom: 10px;
}
.guide li span {
  color: #8c9bb1;
  display: block;
  line-height: 1.8;
  margin-top: 9px;
}
.guide code {
  font-size: 11px;
  background: #101725;
  padding: 5px 7px;
  border-radius: 4px;
  color: #b1c2f5;
}
.guide > p {
  font-size: 11px;
  color: #97a8c3;
  padding: 10px 24px;
  line-height: 1.8;
}
.empty {
  padding: 90px 20px;
  text-align: center;
  color: #8190a8;
  border: 1px dashed #34435d;
  border-radius: 10px;
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 28px 0;
  font-size: 9px;
  color: #53617a;
}
.footer-brand {
  letter-spacing: 1px;
}
.footer-brand span {
  margin: 0 7px;
}
@media (min-width: 1700px) {
  main {
    padding-left: 48px;
    padding-right: 48px;
  }
  .metric-card {
    padding: 22px;
  }
}
@media (max-width: 1250px) {
  .sidebar {
    width: 180px;
    padding: 28px 12px;
  }
  .brand {
    font-size: 16px;
  }
  .brand-mark {
    font-size: 23px;
  }
  .main-shell {
    margin-left: 180px;
  }
  main {
    padding: 28px 24px 0;
  }
  .topbar {
    padding: 0 24px;
  }
  .metrics-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .metric-value {
    font-size: 30px;
  }
  .sample-strip {
    flex-wrap: wrap;
    gap: 12px 24px;
  }
  .sample-note {
    margin-left: 0;
  }
  .metric-footer svg {
    width: 45%;
    opacity: 0.5;
  }
}
@media (max-width: 900px) {
  .sidebar {
    width: 66px;
    padding: 25px 9px;
  }
  .brand {
    padding: 0;
  }
  .brand > span:last-child,
  .workspace-label,
  .sidebar-bottom {
    display: none;
  }
  nav {
    margin-top: 35px;
  }
  nav button {
    font-size: 0;
    gap: 0;
    justify-content: center;
    padding: 13px;
  }
  nav button b {
    display: none;
  }
  .main-shell {
    margin-left: 66px;
  }
  .charts-grid {
    grid-template-columns: 1fr;
  }
  .method-grid {
    grid-template-columns: 1fr 1fr;
  }
  .source-banner div > span {
    display: block;
    margin-top: 5px;
    line-height: 1.6;
  }
  .page-heading {
    align-items: flex-start;
  }
  .heading-actions {
    flex-direction: column;
  }
  .guide ol {
    grid-template-columns: 1fr;
    gap: 18px;
  }
}
@media (max-width: 600px) {
  .sidebar {
    display: none;
  }
  .main-shell {
    margin: 0;
  }
  .topbar {
    height: 51px;
    padding: 0 17px;
  }
  main {
    padding: 25px 15px 0;
  }
  h1 {
    font-size: 25px;
    gap: 10px;
  }
  .eyebrow {
    font-size: 8px;
    letter-spacing: 0.8px;
  }
  .eyebrow span {
    margin: 0 4px;
  }
  .page-heading {
    flex-direction: column;
    gap: 18px;
  }
  .heading-actions {
    flex-direction: row;
    width: 100%;
  }
  .heading-actions .primary {
    margin-left: auto;
  }
  .source-banner {
    padding: 10px;
    gap: 8px;
  }
  .source-banner div > span {
    font-size: 10px;
  }
  .source-banner button {
    font-size: 10px;
    padding: 0;
  }
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
    margin-top: 20px;
  }
  .range-control {
    width: 100%;
  }
  .export-button {
    margin-left: auto;
  }
  .metrics-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .metric-card {
    padding: 15px 13px;
  }
  .metric-value {
    font-size: 27px;
  }
  .metric-label > span {
    font-size: 6px;
  }
  .charts-heading {
    align-items: flex-start;
    gap: 8px;
    flex-direction: column;
  }
  .charts-heading > span {
    font-size: 9px;
  }
  .sample-strip {
    flex-direction: column;
    align-items: flex-start;
  }
  .section-heading {
    padding: 18px 15px;
  }
  .method-grid {
    grid-template-columns: 1fr;
    padding: 0 15px 18px;
    gap: 10px;
  }
  .method-grid p {
    font-size: 11px;
  }
  .section-heading > span {
    font-size: 9px;
  }
  footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
