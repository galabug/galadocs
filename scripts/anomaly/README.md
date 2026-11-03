# A 股异动计算器

已部署页面：`http://kuiklybuild.local:9000/review/anomaly`。按名称或六位代码查询；手动刷新行情快照。现行规则基准日为 2026-07-06，仅作价格类条件推演。

- `src/utils/anomaly.ts`：遍历 3 / 10 / 30 日内全部起点，按复合区间收益率之差计算偏离；反解触发价格，上行向上取整、下行向下取整至分。
- `src/views/AnomalyView.vue`：当前交易日 / 下一交易日、个股与指数收盘假设、公告起算日、同向异动公告日期、复权行情核算表。
- `scripts/anomaly/api.cjs`：免账号腾讯名称搜索、行情快照、前复权日线；新浪日线及复权因子备用。验证日期顺序、行情覆盖及个股与指数日期；缺数据时报错。

基准指数：沪主板上证 A 股 `000002`、深主板深证 A 指 `399107`、创业板综 `399102`、科创 50 `000688`、北证 50 `899050`。2026 年新规下沪深主板 ST 同样使用 3 日 ±20% 的价格类异常波动阈值。

## 服务集成

Mac Build Server 的 `server.js` 已添加 `/review/anomaly` 的页面路由及 `/review/api/anomaly/` 的 GET 接口，由 `review-anomaly.cjs` 处理。`npm run deploy:mac-build-server` 完整构建页面并将 API 模块复制到构建服务根目录。后续只有页面或数据变更时无需重启服务；API 模块代码变更后需要重启构建服务。开发模式下 Vite 将 `/api/anomaly` 代理到本地 9000 端口。

接口：

- `GET /review/api/anomaly/search?q=名称或代码`
- `GET /review/api/anomaly/stock?symbol=sh600519`

公告的次数及重置起算日需要用户核对并输入。未输入时明确标为滚动估算，不能把重叠窗口视为多次已公告异动。停牌缺口、无涨跌幅限制和退市整理等特殊状态不自动给出确定判断。免费行情可能延迟或出现复权精度误差，以交易所公布结果为准。

规则来源：

- [上交所交易规则（2026年修订）](https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml)
- [深交所交易规则（2026年修订）](https://www.szse.cn/lawrules/rule/trade/current/t20260424_620190.html)
- [北交所交易规则](https://www.bse.cn/jygl_list/200028217.html)
