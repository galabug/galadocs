<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { calculateWindow, ruleThresholds } from '@/utils/anomaly'
import type { AnomalyStock, PriceRow } from '@/utils/anomaly'

const previousTitle = document.title
onMounted(() => {
  document.title = 'A股异动计算器 · 收盘之后'
})
onUnmounted(() => {
  document.title = previousTitle
})
const homeUrl = import.meta.env.BASE_URL
const query = ref('')
const results = ref<{ symbol: string; code: string; name: string }[]>([])
const stock = ref<AnomalyStock | null>(null)
const busy = ref(false)
const error = ref('')
const mode = ref('current')
const change = ref(0)
const indexChange = ref(0)
const ordinaryReset = ref('')
const severeReset = ref('')
const eventsUp = ref('')
const eventsDown = ref('')
const confirmedEvents = ref(false)
const excluded = ref(false)
let requestId = 0
const rules = computed(() => ruleThresholds(stock.value?.board.id ?? 'sh'))
const prior = computed(() => (stock.value ? (mode.value === 'current' ? stock.value.previousClose : stock.value.price) : 0))
const candidate = computed(() => Math.round(prior.value * (1 + change.value / 100) * 100) / 100)
const rows = computed<PriceRow[]>(() => {
  if (!stock.value || !Number.isFinite(candidate.value) || candidate.value <= 0 || !Number.isFinite(indexChange.value) || indexChange.value <= -100) return []
  const history = stock.value.rows.map((r) => ({ ...r }))
  const last = history[history.length - 1]!
  if (mode.value === 'next') history.push({ date: '9999-12-31', stockClose: candidate.value, indexClose: last.indexClose * (1 + indexChange.value / 100) })
  else history[history.length - 1] = { ...last, stockClose: candidate.value, indexClose: stock.value.indexPreviousClose * (1 + indexChange.value / 100) }
  return history
})
const cards = computed(() =>
  [
    { name: '短期异常波动', horizon: 3, positive: rules.value.ordinary, negative: -rules.value.ordinary, reset: ordinaryReset.value, label: '连续 3 个交易日内' },
    { name: '10 日严重异常波动', horizon: 10, positive: rules.value.ten, negative: rules.value.tenDown, reset: severeReset.value, label: '连续 10 个交易日内' },
    { name: '30 日严重异常波动', horizon: 30, positive: rules.value.thirty, negative: rules.value.thirtyDown, reset: severeReset.value, label: '连续 30 个交易日内' },
  ].map((c) => ({ ...c, result: calculateWindow(rows.value, c.horizon, c.positive, c.negative, c.reset) })),
)
const blocked = computed(() => excluded.value || stock.value?.excluded || !rows.value.length)
const priceLimit = computed(() => stock.value?.board.limit ?? 10)
const upper = computed(() => (stock.value && mode.value === 'current' && stock.value.upper ? stock.value.upper : Math.round(prior.value * (1 + priceLimit.value / 100) * 100) / 100))
const lower = computed(() => (stock.value && mode.value === 'current' && stock.value.lower ? stock.value.lower : Math.round(prior.value * (1 - priceLimit.value / 100) * 100) / 100))
const quoteChange = computed(() => (stock.value ? (stock.value.price / stock.value.previousClose - 1) * 100 : 0))
const dailyThreshold = computed(() => (stock.value?.board.id === 'bse' ? 20 : ['star', 'chinext'].includes(stock.value?.board.id ?? '') ? 15 : 7))
const dailyDeviation = computed(() => (candidate.value / prior.value - 1) * 100 - indexChange.value)
const dailyUsesDeviation = computed(() => ['sh', 'sz'].includes(stock.value?.board.id ?? 'sh'))
const dailyTrigger = computed(() => prior.value * (1 + (dailyThreshold.value + (dailyUsesDeviation.value ? indexChange.value : 0)) / 100))
const historyRows = computed(() => stock.value?.rows.slice(-31).reverse() ?? [])
const chart = computed(() => {
  const data = stock.value?.rows.slice(-31) ?? []
  if (!data.length) return { stock: '', index: '', zero: 80 }
  const base = data[0]!
  const a = data.map((r) => (r.stockClose / base.stockClose - 1) * 100)
  const b = data.map((r) => (r.indexClose / base.indexClose - 1) * 100)
  const min = Math.min(0, ...a, ...b) - 2,
    max = Math.max(0, ...a, ...b) + 2
  const points = (v: number[]) => v.map((y, i) => `${(i / Math.max(1, v.length - 1)) * 900},${155 - ((y - min) / (max - min)) * 140}`).join(' ')
  return { stock: points(a), index: points(b), zero: 155 - ((0 - min) / (max - min)) * 140 }
})
const eventStatus = computed(() => {
  if (!confirmedEvents.value) return '尚未核对公告，无法确认同向异动次数。'
  const lastDates = new Set(rows.value.slice(-10).map((r) => r.date))
  const count = (text: string) => new Set((text.match(/\d{4}-\d{2}-\d{2}/g) ?? []).filter((d) => lastDates.has(d) && (!severeReset.value || d >= severeReset.value))).size
  return `当前窗口内已录入正向 ${count(eventsUp.value)} 次、负向 ${count(eventsDown.value)} 次。达到 ${rules.value.events} 次同向异动构成严重异动；仍需核对公告统计区间。`
})
function dateLabel(value: string | undefined) {
  return value === '9999-12-31' ? '下一交易日' : (value ?? '—')
}
function fmt(value: number | undefined | null, digits = 2) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}
function signed(value: number | undefined | null) {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${fmt(value)}%`
}
function reach(price: number | undefined, direction: 'up' | 'down') {
  if (price == null || price <= 0) return '无有效触发价'
  if ((direction === 'up' && price > upper.value + 1e-6) || (direction === 'down' && price < lower.value - 1e-6)) return `较行情价${direction === 'up' ? '上涨' : '下跌'} ${fmt(Math.abs((price / (stock.value?.price || candidate.value) - 1) * 100))}%，超出本日涨跌停范围`
  if ((direction === 'up' && candidate.value >= price) || (direction === 'down' && candidate.value <= price)) return '当前情景已达数值阈值'
  return direction === 'up' ? `较情景价还需上涨 ${fmt((price / candidate.value - 1) * 100)}%` : `较情景价还需下跌 ${fmt((1 - price / candidate.value) * 100)}%`
}
async function api(path: string) {
  const response = await fetch(`${import.meta.env.BASE_URL}api/anomaly/${path}`)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '查询失败')
  return body
}
async function search() {
  if (!query.value.trim() || busy.value) return
  const id = ++requestId
  busy.value = true
  error.value = ''
  results.value = []
  try {
    const body = await api(`search?q=${encodeURIComponent(query.value.trim())}`)
    if (id !== requestId) return
    results.value = body.results
    if (results.value.length === 1) await load(results.value[0]!.symbol)
    else if (!results.value.length) error.value = '没有找到匹配的 A 股，请尝试六位股票代码'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查询失败'
  } finally {
    if (id === requestId) busy.value = false
  }
}
async function load(symbol: string) {
  busy.value = true
  error.value = ''
  stock.value = null
  try {
    const body: AnomalyStock = await api(`stock?symbol=${encodeURIComponent(symbol)}`)
    stock.value = body
    results.value = []
    mode.value = 'current'
    ordinaryReset.value = ''
    severeReset.value = ''
    eventsUp.value = ''
    eventsDown.value = ''
    confirmedEvents.value = false
    excluded.value = false
    resetScenario()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '行情读取失败'
  } finally {
    busy.value = false
  }
}
function setMode(value: string) {
  mode.value = value
  resetScenario()
}
function resetScenario() {
  if (!stock.value) return
  change.value = mode.value === 'current' ? Number(quoteChange.value.toFixed(4)) : 0
  const index = stock.value.rows[stock.value.rows.length - 1]!
  indexChange.value = mode.value === 'current' ? Number(((index.indexClose / stock.value.indexPreviousClose - 1) * 100).toFixed(4)) : 0
}
function setPrice(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value) && value > 0) change.value = (value / prior.value - 1) * 100
}
</script>

<template>
  <main class="anomaly-page">
    <header class="page-header">
      <div>
        <a class="back" :href="homeUrl">← 盘后复盘</a>
        <p class="eyebrow">A-SHARE · PRICE DEVIATION</p>
        <h1>异动计算器<span>看清偏离，推演边界。</span></h1>
      </div>
      <span class="rule-tag">2026.07.06 起现行规则</span>
    </header>
    <section class="search-panel">
      <form @submit.prevent="search">
        <label for="stock-search">股票名称 / 代码</label>
        <div class="search-line">
          <input id="stock-search" v-model="query" placeholder="如：平安银行、000001、贵州茅台" maxlength="30" autocomplete="off" /><button :disabled="busy || !query.trim()">{{ busy ? '正在读取行情…' : '查询并计算 →' }}</button>
        </div>
      </form>
      <p class="search-note">沪深主板 / 创业板 / 科创板 / 北交所 · 免费行情快照，手动查询刷新</p>
      <div v-if="results.length" class="search-results">
        <button v-for="s in results" :key="s.symbol" :disabled="busy" @click="load(s.symbol)">
          <strong>{{ s.name }}</strong
          ><span>{{ s.code }} · {{ s.symbol.slice(0, 2).toUpperCase() }}</span>
        </button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
    <template v-if="stock">
      <section class="stock-header">
        <div>
          <span class="board-tag">{{ stock.board.label }}</span>
          <h2>
            {{ stock.name }} <small>{{ stock.code }}</small>
          </h2>
          <p>基准：{{ stock.board.benchmarkName }} {{ stock.board.benchmark.slice(2) }}</p>
        </div>
        <div class="quote">
          <strong :class="quoteChange >= 0 ? 'rise' : 'fall'">{{ fmt(stock.price) }}</strong
          ><span :class="quoteChange >= 0 ? 'rise' : 'fall'">{{ signed(quoteChange) }}</span
          ><small>行情截至 {{ stock.quoteAt }}（北京时间）</small>
        </div>
      </section>
      <div class="notice">以下是行情快照的条件推演。公告后的重新起算、停复牌及无涨跌幅限制期间会影响结果，请在下方校准。触及数值条件不代表必然停牌或收到监管措施。</div>
      <div class="workspace">
        <aside class="scenario-panel">
          <h3><span class="section-number">01</span> 收盘情景</h3>
          <div class="mode-switch"><button :class="{ active: mode === 'current' }" @click="setMode('current')">行情所在交易日</button><button :class="{ active: mode === 'next' }" @click="setMode('next')">下一交易日</button></div>
          <p class="muted">{{ mode === 'current' ? stock.rows[stock.rows.length - 1]?.date : '在最后一个行情交易日之后推演' }} · 昨收基准 ¥{{ fmt(prior) }}</p>
          <label class="field">个股收盘涨跌幅 <span>%</span><input v-model.number="change" type="number" min="-99" max="500" step="0.1" /></label>
          <input v-model.number="change" class="slider" aria-label="个股涨跌幅滑块" type="range" :min="-priceLimit" :max="priceLimit" step="0.1" />
          <div class="quick-buttons"><button @click="change = -priceLimit">跌停</button><button @click="change = 0">平盘</button><button @click="change = priceLimit">涨停</button></div>
          <label class="field">或直接输入收盘价 <span>元</span><input :value="candidate" type="number" min="0.01" step="0.01" @change="setPrice" /></label>
          <label class="field">{{ stock.board.benchmarkName }}收盘涨跌幅 <span>%</span><input v-model.number="indexChange" type="number" min="-99" max="100" step="0.1" /></label>
          <button class="text-button" @click="resetScenario">恢复行情值 / 下一日平盘假设</button>
          <div class="scenario-total">
            <span>情景收盘价</span><strong>¥{{ fmt(candidate) }}</strong
            ><small>当前涨跌停参考 ¥{{ fmt(lower) }} — ¥{{ fmt(upper) }}</small>
            <p v-if="candidate > upper || candidate < lower" class="error">此情景超出本日正常涨跌停范围</p>
          </div>
        </aside>
        <section class="calculation-panel">
          <h3><span class="section-number">02</span> 异动触发边界 <small>按 0.01 元报价单位取整</small></h3>
          <div v-if="blocked" class="error blocked">无有效情景，或该证券处于不纳入异动计算的特殊期间，暂停显示触发结果。</div>
          <div v-else class="cards">
            <article v-for="c in cards" :key="c.horizon" class="trigger-card">
              <header>
                <div>
                  <h4>{{ c.name }}</h4>
                  <p>{{ c.label }} · +{{ c.positive }}% / {{ c.negative }}%</p>
                </div>
                <span class="window-tag">{{ c.result.available }}/{{ c.horizon }} 个起点</span>
              </header>
              <div class="deviation-values">
                <div>
                  <span>窗口内最大偏离</span><strong class="rise">{{ signed(c.result.currentHigh?.deviation) }}</strong>
                </div>
                <div>
                  <span>窗口内最小偏离</span><strong class="fall">{{ signed(c.result.currentLow?.deviation) }}</strong>
                </div>
              </div>
              <div class="boundaries">
                <div>
                  <span class="rise">↑ 上行触发价</span><strong>¥{{ fmt(c.result.up?.upPrice) }}</strong
                  ><b>当日总涨幅 {{ signed(c.result.up ? (c.result.up.upPrice / prior - 1) * 100 : null) }}</b>
                  <p>{{ reach(c.result.up?.upPrice, 'up') }}</p>
                  <small>{{ c.result.up?.days }} 日窗口 · {{ dateLabel(c.result.up?.start) }} 起</small>
                </div>
                <div>
                  <span class="fall">↓ 下行触发价</span><strong>¥{{ fmt(c.result.down?.downPrice) }}</strong
                  ><b>当日总涨幅 {{ signed(c.result.down ? (c.result.down.downPrice / prior - 1) * 100 : null) }}</b>
                  <p>{{ reach(c.result.down?.downPrice, 'down') }}</p>
                  <small>{{ c.result.down?.days }} 日窗口 · {{ dateLabel(c.result.down?.start) }} 起</small>
                </div>
              </div>
              <p v-if="!c.reset" class="estimate">未校准公告起算日 · 滚动估算</p>
            </article>
          </div>
          <div class="other-rules">
            <article>
              <h4>10 日内 {{ rules.events }} 次同向异动</h4>
              <p>{{ eventStatus }}</p>
              <small>下一次异动的价格可参照上方「短期异常波动」边界，并用最新公告起算日校准。相互重叠的滚动窗口不能直接计作多次公告。</small>
            </article>
            <article>
              <h4>单日交易公开信息条件</h4>
              <p>当日{{ dailyUsesDeviation ? '偏离值' : '涨跌幅' }} {{ signed(dailyUsesDeviation ? dailyDeviation : (candidate / prior - 1) * 100) }} · 阈值 ±{{ dailyThreshold }}%</p>
              <small>上行价格约 ¥{{ fmt(dailyTrigger) }}。另需满足前 5 只排名，达到该数值不等于确定上榜；这项不等同于异常波动。</small>
            </article>
          </div>
        </section>
      </div>
      <section class="calibration">
        <h3><span class="section-number">03</span> 公告与特殊状态校准</h3>
        <p class="muted">输入公告明确的重新起算日（通常为公布次一交易日或复牌日）。空白时只提供未经公告重置的滚动测算。</p>
        <div class="calibration-grid">
          <label>短期异常指标起算日<input v-model="ordinaryReset" type="date" min="2026-07-06" :max="mode === 'current' ? stock.rows[stock.rows.length - 1]?.date : undefined" /></label><label>严重异常指标起算日<input v-model="severeReset" type="date" min="2026-07-06" :max="mode === 'current' ? stock.rows[stock.rows.length - 1]?.date : undefined" /></label
          ><label>已公告正向异动日期<textarea v-model="eventsUp" placeholder="2026-10-29, 2026-11-02" /></label><label>已公告负向异动日期<textarea v-model="eventsDown" placeholder="按 YYYY-MM-DD 输入，逗号分隔" /></label>
        </div>
        <label class="check"><input v-model="confirmedEvents" type="checkbox" />我已核对当前窗口内的全部异动公告（空白代表没有公告）</label><label class="check"><input v-model="excluded" type="checkbox" />处于无涨跌幅限制 / 退市整理等不纳入异动计算的期间</label>
      </section>
      <section class="history-panel">
        <div class="history-heading">
          <h3>近 30 日相对走势</h3>
          <p><i class="stock-dot" />{{ stock.name }}<i class="index-dot" />{{ stock.board.benchmarkName }}<span>首个点归零，区间收益率</span></p>
        </div>
        <svg class="trend" viewBox="0 0 900 175" role="img" aria-label="个股与基准指数近三十日收益率走势">
          <line x1="0" x2="900" :y1="chart.zero" :y2="chart.zero" stroke="#d7dde5" stroke-dasharray="4 5" />
          <polyline :points="chart.index" fill="none" stroke="#93a4ba" stroke-width="2" />
          <polyline :points="chart.stock" fill="none" stroke="#245dec" stroke-width="3" />
        </svg>
        <details>
          <summary>展开核算数据（前复权价格）</summary>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>交易日</th>
                  <th>个股前复权价</th>
                  <th>基准指数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in historyRows" :key="r.date">
                  <td>{{ r.date }}</td>
                  <td>{{ fmt(r.stockClose, 4) }}</td>
                  <td>{{ fmt(r.indexClose, 4) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <p class="source-note">{{ stock.source }} · 个股 {{ stock.quoteAt }} / 指数 {{ stock.indexAt }}。行情可能延迟；前复权取价存在精度差异，正式结果以交易所公告为准。缺失数据时不会以零值填充。</p>
    </template>
    <section v-else-if="!busy" class="empty-state">
      <div class="empty-mark">Δ</div>
      <h2>先选一只股票，查看它距离异动还有多远。</h2>
      <p>输入名称或六位代码，即可加载真实行情。支持当前收盘情景和下一交易日推演。</p>
      <div class="empty-grid">
        <span><b>03</b>短期异常波动</span><span><b>10</b>严重异常波动</span><span><b>30</b>严重异常波动</span>
      </div>
    </section>
    <footer class="rules-footer">
      <h3>规则与计算方法</h3>
      <p>累计偏离值 =（个股期末复权价 ÷ 期初前复权价 − 指数期末点位 ÷ 期初前点位）× 100%。每档在最多 N 个交易日内遍历所有可用起点，取最早可触及的价格；候选收盘价和指数假设共同决定结果。这里仅计算价格类条件，换手率等其他异动条件未纳入。</p>
      <p>沪深主板：3 日 ±20%，10 日 +100% / −50%，30 日 +200% / −70%，10 日 4 次同向异动。创业板、科创板：3 日 ±30%，10 日 3 次同向异动，其他累计偏离阈值同沪深主板。北交所：3 日 ±40%，10 日 +150% / −60%，30 日 +300% / −75%，10 日 3 次同向异动。北交所免费历史覆盖不足时会提示不可计算。</p>
      <div>
        <a href="https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml" target="_blank" rel="noopener">上交所交易规则 ↗</a><a href="https://www.szse.cn/lawrules/rule/trade/current/t20260424_620190.html" target="_blank" rel="noopener">深交所交易规则 ↗</a
        ><a href="https://www.bse.cn/jygl_list/200028217.html" target="_blank" rel="noopener">北交所交易规则 ↗</a>
      </div>
    </footer>
  </main>
</template>

<style scoped>
.anomaly-page {
  --ink: #15243b;
  --muted: #758196;
  --blue: #245dec;
  --line: #e5eaf1;
  min-height: 100vh;
  background: #f4f6fa;
  color: var(--ink);
  padding: 40px max(24px, calc((100vw - 1360px) / 2));
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-variant-numeric: tabular-nums;
}
* {
  box-sizing: border-box;
}
button,
input,
textarea {
  font: inherit;
}
button {
  cursor: pointer;
  transition: background 0.15s;
}
button:disabled {
  opacity: 0.55;
  cursor: wait;
}
input,
textarea {
  outline: none;
}
input:focus,
textarea:focus {
  border-color: var(--blue) !important;
  box-shadow: 0 0 0 3px #245dec12;
}
a {
  color: var(--blue);
  text-decoration: none;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28px;
}
.back {
  font-size: 13px;
  color: var(--muted);
}
.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--blue);
  margin: 22px 0 10px;
}
h1 {
  font-size: 32px;
  letter-spacing: -1px;
  margin: 0;
}
h1 span {
  font-size: 15px;
  font-weight: 400;
  color: var(--muted);
  margin-left: 20px;
  letter-spacing: 0;
}
.rule-tag,
.board-tag {
  display: inline-block;
  background: #e7edfc;
  color: var(--blue);
  padding: 7px 12px;
  font-size: 12px;
  border-radius: 5px;
}
.search-panel {
  background: #fff;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.search-panel label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
}
.search-line {
  display: flex;
  gap: 12px;
}
.search-line input {
  flex: 1;
  min-width: 0;
  border: 1px solid #d7deea;
  border-radius: 7px;
  padding: 13px 16px;
  background: #fafbfe;
}
.search-line button {
  border: 0;
  border-radius: 7px;
  background: var(--blue);
  color: white;
  padding: 12px 24px;
  font-weight: 600;
}
.search-note,
.muted,
.search-panel p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.search-note {
  margin: 10px 0 0;
}
.search-results {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.search-results button {
  border: 1px solid var(--line);
  background: white;
  border-radius: 7px;
  padding: 12px;
  text-align: left;
}
.search-results span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-top: 5px;
}
.error {
  color: #b84526 !important;
  background: #fff0e9;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
}
.stock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30px 0 20px;
}
.stock-header h2 {
  font-size: 26px;
  margin: 10px 0;
}
.stock-header h2 small {
  font-size: 15px;
  font-weight: 400;
  color: var(--muted);
  margin-left: 10px;
}
.stock-header p {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}
.quote {
  text-align: right;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 430px;
}
.quote strong {
  font-size: 36px;
  letter-spacing: -1px;
}
.quote small {
  display: block;
  flex-basis: 100%;
  font-size: 11px;
  color: var(--muted);
}
.rise {
  color: #d4534c;
}
.fall {
  color: #15977a;
}
.notice {
  font-size: 12px;
  line-height: 1.9;
  background: #eaf0fc;
  color: #516688;
  border-left: 3px solid var(--blue);
  padding: 12px 16px;
  margin-bottom: 22px;
}
.workspace {
  display: grid;
  grid-template-columns: 270px 1fr;
  gap: 20px;
  align-items: start;
}
h3 {
  font-size: 15px;
  margin: 0 0 20px;
  font-weight: 650;
}
.section-number {
  font-size: 11px;
  color: var(--blue);
  margin-right: 8px;
}
.scenario-panel,
.calculation-panel,
.calibration,
.history-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
}
.mode-switch {
  display: flex;
  background: #f0f3f8;
  border-radius: 6px;
  padding: 3px;
}
.mode-switch button {
  font-size: 11px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 9px 4px;
  flex: 1;
  border-radius: 4px;
}
.mode-switch button.active {
  background: white;
  color: var(--blue);
  box-shadow: 0 1px 5px #15243b10;
}
.field {
  display: block;
  margin-top: 20px;
  font-size: 12px;
  font-weight: 600;
}
.field span {
  float: right;
  color: var(--muted);
  font-weight: 400;
}
.field input {
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  font-size: 18px;
  color: var(--ink);
  background: #fcfdff;
}
.slider {
  width: 100%;
  accent-color: var(--blue);
  margin: 16px 0 8px;
}
.quick-buttons {
  display: flex;
  gap: 7px;
}
.quick-buttons button {
  flex: 1;
  background: #f5f7fb;
  color: #65728a;
  border: 0;
  border-radius: 4px;
  padding: 7px;
  font-size: 11px;
}
.text-button {
  border: 0;
  background: transparent;
  color: var(--blue);
  font-size: 11px;
  padding: 15px 0;
}
.scenario-total {
  border-top: 1px solid var(--line);
  padding-top: 18px;
}
.scenario-total span,
.scenario-total small {
  display: block;
  font-size: 11px;
  color: var(--muted);
}
.scenario-total strong {
  display: block;
  font-size: 30px;
  margin: 8px 0;
}
.calculation-panel h3 {
  display: flex;
  align-items: center;
}
.calculation-panel h3 small {
  margin-left: auto;
  color: var(--muted);
  font-weight: 400;
  font-size: 11px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.trigger-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.trigger-card header {
  padding: 17px 14px;
  background: #fafbfe;
  min-height: 99px;
}
.trigger-card h4 {
  font-size: 14px;
  margin: 0 0 8px;
}
.trigger-card header p {
  font-size: 10px;
  color: var(--muted);
  margin: 0;
}
.window-tag {
  font-size: 10px;
  color: #8c99ad;
  display: block;
  margin-top: 8px;
}
.deviation-values {
  padding: 16px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.deviation-values div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.deviation-values span {
  font-size: 10px;
  color: var(--muted);
}
.deviation-values strong {
  font-size: 17px;
  font-weight: 600;
}
.boundaries > div {
  padding: 15px 14px;
}
.boundaries > div + div {
  border-top: 1px dashed var(--line);
}
.boundaries span {
  display: block;
  font-size: 11px;
  font-weight: 600;
}
.boundaries strong {
  display: block;
  font-size: 24px;
  letter-spacing: -0.5px;
  margin: 6px 0;
}
.boundaries b {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #65728a;
}
.boundaries p {
  font-size: 10px;
  line-height: 1.6;
  color: #5c6b80;
  margin: 10px 0 4px;
}
.boundaries small {
  font-size: 10px;
  color: #98a2b2;
}
.estimate {
  font-size: 10px;
  color: #ad8758;
  background: #fcf8f1;
  margin: 0;
  padding: 9px 10px;
  text-align: center;
}
.other-rules {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 18px;
}
.other-rules article {
  background: #f7f9fc;
  padding: 14px;
  border-radius: 6px;
}
.other-rules h4 {
  font-size: 12px;
  margin: 0 0 9px;
}
.other-rules p {
  font-size: 12px;
  line-height: 1.8;
  margin: 0 0 8px;
}
.other-rules small {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.8;
  display: block;
}
.calibration {
  margin-top: 20px;
}
.calibration-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin: 18px 0;
}
.calibration-grid label {
  font-size: 11px;
  color: #65728a;
}
.calibration-grid input,
.calibration-grid textarea {
  display: block;
  width: 100%;
  margin-top: 9px;
  border: 1px solid var(--line);
  padding: 10px;
  border-radius: 5px;
  background: #fafbfe;
  min-height: 40px;
  font-size: 12px;
}
.calibration-grid textarea {
  height: 40px;
  resize: vertical;
}
.check {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  margin-top: 12px;
}
.check input {
  accent-color: var(--blue);
}
.history-panel {
  margin-top: 20px;
}
.history-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.history-heading p {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  flex-wrap: wrap;
}
.history-heading i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: 12px;
}
.stock-dot {
  background: var(--blue);
}
.index-dot {
  background: #93a4ba;
}
.history-heading p span {
  margin-left: 12px;
}
.trend {
  width: 100%;
  height: 190px;
}
.history-panel summary {
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  padding: 12px 0;
}
.table-scroll {
  max-height: 260px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: right;
}
td,
th {
  padding: 10px;
  border-bottom: 1px solid var(--line);
}
th {
  position: sticky;
  top: 0;
  background: #f7f9fc;
}
td:first-child,
th:first-child {
  text-align: left;
}
.source-note {
  font-size: 10px;
  line-height: 1.9;
  color: var(--muted);
  padding: 0 5px;
}
.rules-footer {
  margin-top: 35px;
  border-top: 1px solid #dce3ed;
  padding-top: 25px;
  color: var(--muted);
}
.rules-footer h3 {
  font-size: 13px;
  margin-bottom: 12px;
}
.rules-footer p {
  font-size: 11px;
  line-height: 2;
}
.rules-footer a {
  font-size: 11px;
  display: inline-block;
  margin: 6px 24px 0 0;
}
.empty-state {
  text-align: center;
  padding: 70px 20px 55px;
}
.empty-mark {
  font-size: 48px;
  color: #9ab4ef;
  font-weight: 300;
}
.empty-state h2 {
  font-size: 21px;
  font-weight: 500;
  margin-top: 14px;
}
.empty-state > p {
  font-size: 13px;
  color: var(--muted);
}
.empty-grid {
  display: flex;
  justify-content: center;
  gap: 70px;
  margin-top: 35px;
}
.empty-grid span {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  color: var(--muted);
  gap: 10px;
}
.empty-grid b {
  font-size: 30px;
  font-weight: 400;
  color: #a8b7d0;
}
.blocked {
  min-height: 160px;
}
@media (min-width: 1500px) {
  .anomaly-page {
    padding-top: 48px;
  }
}
@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: 230px 1fr;
    gap: 12px;
  }
  .scenario-panel,
  .calculation-panel {
    padding: 15px;
  }
  .cards {
    gap: 7px;
  }
  .boundaries strong {
    font-size: 21px;
  }
  .calibration-grid {
    grid-template-columns: 1fr 1fr;
  }
  .trigger-card header {
    padding: 13px 10px;
  }
  .deviation-values,
  .boundaries > div {
    padding: 13px 10px;
  }
}
@media (max-width: 800px) {
  .anomaly-page {
    padding: 24px 16px;
  }
  h1 span {
    display: block;
    margin: 10px 0 0;
    font-size: 13px;
  }
  .rule-tag {
    display: none;
  }
  .workspace {
    display: block;
  }
  .scenario-panel {
    margin-bottom: 16px;
  }
  .scenario-panel .field {
    display: inline-block;
    width: 48%;
    margin-right: 2%;
  }
  .scenario-panel .slider {
    display: none;
  }
  .quick-buttons {
    margin-top: 15px;
  }
  .scenario-total {
    margin-top: 10px;
  }
  .calculation-panel {
    padding: 16px;
  }
  .other-rules {
    grid-template-columns: 1fr;
  }
  .history-heading {
    display: block;
  }
  .search-line button {
    padding: 10px 12px;
    font-size: 12px;
  }
  .quote strong {
    font-size: 28px;
  }
  .stock-header h2 {
    font-size: 22px;
  }
  .stock-header {
    gap: 12px;
  }
  .cards {
    grid-template-columns: 1fr;
  }
  .trigger-card header {
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .boundaries {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .boundaries > div + div {
    border-top: 0;
    border-left: 1px dashed var(--line);
  }
  .deviation-values {
    flex-direction: row;
  }
  .deviation-values div {
    flex-direction: column;
    gap: 6px;
  }
  .calibration-grid {
    grid-template-columns: 1fr;
  }
  .empty-grid {
    gap: 35px;
  }
  .empty-state h2 {
    font-size: 17px;
  }
  .history-heading p {
    margin-left: -12px;
  }
  .calculation-panel h3 small {
    font-size: 9px;
  }
}
</style>
