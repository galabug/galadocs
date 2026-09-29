# 免费多源盘后复盘

默认无需账号、无需 Token。Python 采集 → SQLite 历史 → JSON → Vue 图表。网页优先加载真实数据，仅在真实文件不存在时进入明确标注的示例模式。

## 1. 运行

当前项目已安装 `.venv-review`，直接执行：

```bash
npm run review:collect
npm run dev -- --host 127.0.0.1
```

在其他机器上首次安装：

```bash
python3 -m venv .venv-review
.venv-review/bin/python -m pip install -r scripts/market_review/requirements.txt
npm install
npm run review:collect
```

Python 3.9+，macOS / Linux。`run.py` 自动使用项目虚拟环境，不更改全局 Python。BaoStock 固定为官方 0.9.4，使用其默认匿名公共节点，不需要注册或申请 API Key。API 客户端被隔离在一个可复用的工作进程中，每次请求有 45 秒硬超时，连接错误最多重连两次，退出时清理连接。

前端支持日期联动、20 / 40 / 60 日窗口、图例显隐、历史明细、CSV 导出。刷新网页只是重新读取结果，不会后台触发采集。

## 2. 已接入的来源及边界

| 来源 | 用途 | 自动备用行为 | 限制 |
| --- | --- | --- | --- |
| **BaoStock** | 默认完整复盘主源：历史日行情、当日 ST 标记、除权昨收、证券上市日期、交易日历 | 主源失败时尝试东方财富近期股池 | 涨跌停按主板规则计算；特殊重新上市等例外需核对 |
| **东方财富** | 近期涨跌停池、连板统计、昨日涨停股票今日表现 | 自动作为完整复盘的近期备用；可显式指定 | 近期窗口不足以保证 40 日初始化；当前网络实测连接失败，不能承诺随时可用 |
| **腾讯证券** | 指数交易日、个股历史行情验证 | BaoStock 日历失败时优先接管交易日校验 | 无独立历史 ST/全市场封板池；不能凭个股 K 线替代完整复盘 |
| **新浪财经** | 指数交易日、个股历史行情验证 | 腾讯日历也失败时接管交易日校验 | 同样不是完整复盘替代品；其未复权个股 K 线不能直接替代除权收益率 |

**四个网站不等于四套可互换的完整复盘数据。** 腾讯/新浪是实际接入的日历备用与行情诊断，东方财富是近期复盘备用；它们不能无损代替 BaoStock 的历史 ST 数据。没有足够信息时程序报错保留旧结果，不会用今天的 ST 名单回填历史，也不会用模拟数据冒充真实数据。同花顺公开专题接口在本机连接失败，未将其计入已接入来源。

```bash
# 检查四源，状态及检测时间显示在界面
npm run review:sources

# 默认自动主备（BaoStock → 东方财富）
npm run review:collect

# 只用指定的完整复盘源
npm run review:collect -- --source baostock
npm run review:collect -- --source eastmoney

# 免费源之外仍保留原 Tushare 适配器，需要自行配置 Token
npm run review:collect -- --source tushare
```

`--check-sources` 只检查并生成 `sources.json`，不会覆盖复盘历史。它检查当前最近已完成交易日的真实数据；网页的“重新读取检测结果”不触发网络检测。界面标注的是**最后一次检测结果**及其时间，不是持续在线保证。

免费接口可能限流、变更或停用。HTTP 请求间隔 0.3 秒，失败最多两次请求；同一次采集发生故障后熔断该源，避免对每个历史日重复请求。数据源切换会记录在每一天的 `poolSource` / `quoteSource` / `method` 中，页面显示所选日期的实际来源，不统一伪装成某一个供应商。

## 3. 指标口径

| 指标 | 计算方式 | 图表 |
| --- | --- | --- |
| 股票范围 | 沪深 A 股主板，按**历史当日** ST 标记过滤 | 全页面 |
| 涨停 / 跌停 | 收盘价等于当日规则计算的涨 / 跌停价，不计盘中触板 | 分组柱状图 |
| 连板家数 | 连续至少 2 个市场交易日收盘涨停 | 面积图 |
| 昨日涨停溢价 | 上一交易日涨停池中，今日有效股票收益率等权平均 | 双折线图 |
| 昨日连板溢价 | 上一交易日连板池中，今日有效股票收益率等权平均 | 同上 |
| 最高 / 最低连板 | 当日连板集合中连续板数的最大 / 最小值 | 双折线图 |

主板代码段为沪市 `600/601/603/605` 和深市 `000/001/002/003`，同时检查交易所后缀。若交易所新增主板代码段，需要更新过滤规则。

### BaoStock 主源

- 用未复权收盘价和**除权除息后的前收盘价**，以 `Decimal` 按主板 10% 涨跌幅和 0.01 元价格单位四舍五入，价差不足 0.01 元时按最小报价单位增减，比较精确价格；不使用“涨幅大于 9.9%”近似。
- 根据上市日期与交易日历排除注册制主板新股前 5 个交易日（2023-04-10 起上市）；旧制上市首日单独排除。
- 先用证券基础资料推导当日应有主板证券集合，检查日行情覆盖、重复证券、日期及字段；缺失时拒绝发布。
- `isST=1` 不计，`tradestatus=0` 停牌不计入当日封板或溢价分母；停牌会中断本程序按**市场交易日**定义的连板。
- 连板向前追溯直到断板，而不是在 40 日窗口起点归零。若追溯到日历边界仍未断板，则报错，不发布截断的板数。
- 这是**规则推算结果**，不是交易所提供的官方封板标记。特殊重新上市、恢复上市、不设涨跌幅限制等例外尚未有统一免费状态表，需人工核对；退市整理状态也没有被此源单独识别。原始数据保留便于核验。

### 东方财富备用

使用上游收盘涨跌停池和连板数，筛主板、剔除名称含 ST 或“退”的股票；该上游涨停池不含未中断一字涨停的新股，与 BaoStock 的价格规则推算口径可能不同。返回 `qdate` 必须与请求一致，完整条数必须匹配。空 `data` 不等于零家涨停，涨跌停池同时为空时会保守报错。历史超过 30 个自然日不尝试此源，不能保证其覆盖 40 个交易日。

溢价使用该日“昨日涨停池”的价格和涨跌幅，匹配本地上一交易日股票集合，不重新按今日幸存股票挑选样本；今日无成交或缺行情不计入均值。若两个日期来自不同池口径，样本匹配可能减少，剔除数会如实显示。

### 溢价与空值

日收益率 = `(今日收盘 / 除权昨收 - 1) × 100%`，再对有效样本等权平均。昨日是前一个交易日，不是自然日前一天。今日 ST、停牌或缺行情会剔除并计数；无有效样本为 `null`（“—”），不能写 0。无连板时最高 / 最低也为 `null`，图表断线；最低连板通常是 2。

## 4. 回填、增量与缓存

- 首次默认 **40 个交易日**，额外取昨日池和更早的连板追溯数据。首次回填需要连续获取数十个全市场日文件，耗时取决于免费节点；终端显示下载进度。
- 后续补齐漏跑交易日，重算最近 3 日接收修订，保留全部历史；交易日来自 BaoStock，腾讯/新浪指数日期作备用。
- 18:00 前默认截止到前一自然日，再由交易日历定位最近开市日。这样给 BaoStock 约 17:30 的日线入库留出时间；建议 18:30 运行。
- SQLite 按日期主键 UPSERT，批次事务避免部分统计发布；JSON 用原子替换。当日最新数据延迟或未通过校验时，保存此前已补齐的历史，在 JSON 的 pendingDay 和页面提示中记录待补日期，下次继续补采；历史缺口采集失败仍回滚本批次。采集中断后上次网页结果保留，已校验的日行情原始缓存可以在重跑时复用。
- 最近重算窗口及其前一交易日的原始数据会重新下载；其他日复用缓存。上游修订旧数据时用更大的 `--refresh` 重算。
- 免费来源与 Tushare 使用不同数据库，避免覆盖旧数据。自动主备的两种免费复盘口径可混合在同库，但逐日保留来源，并在页面明确提示。

```bash
npm run review:collect -- --end 2026-09-24
npm run review:collect -- --refresh 10
npm run review:collect -- --days 60 --database data/review-60.sqlite3
```

`--days` 仅影响新数据库初始化；`--end` 不删除已有的后续历史。如需独立历史截面，应同时指定新的 `--database` 和 `--output`。

文件位置（真实数据和虚拟环境均忽略 Git）：

- `data/market-review-free.sqlite3`：免费源历史
- `data/market-review-tushare.sqlite3`：可选 Tushare 历史
- `public/a/YYYY-MM-DD/baostock.json`：通过校验的原始主板日行情，按日追加保留；可通过 `/a/YYYY-MM-DD/baostock.json` 读取。JSON 是股票记录数组，保留源字段（含 OHLC、昨收、成交量、成交额、ST 与停牌标记）；原始层保留 ST 股票供其他策略筛选，复盘统计仍剔除 ST。历史旧缓存已复制到此目录，后续读写使用新路径。
- `public/data/review.json`：网页真实指标
- `public/data/sources.json`：来源能力和最近检测结果
- `public/data/review-demo.json`：独立示例，`npm run review:demo` 生成，永不作为真实采集失败的替代结果发布

## 5. 每天执行

现在不需要配置行情密钥。本机已在 Codex 当前任务内创建“主板非 ST 盘后复盘”定时任务，每天北京时间 18:30 执行采集并同步已有构建目录的数据。请在 Codex 的定时任务中管理；电脑须开机、项目所在磁盘可用、应用保持运行。定时任务使用 Codex 账户额度，行情接口本身无需账号。未安装操作系统级定时任务。

如果以后改用独立系统定时器，先停用 Codex 中的该任务，避免重复运行。macOS/Linux 可以用以下脚本作为入口：

```sh
#!/bin/sh
set -eu
cd /Volumes/ssd/angrybug/galadocs
mkdir -p data
./.venv-review/bin/python scripts/market_review/collect.py >> data/collect.log 2>&1
```

机器系统时区为 Asia/Shanghai 时，每天北京时间 18:30：

```cron
30 18 * * * /bin/sh /absolute/path/run-market-review.sh
```

电脑关闭或休眠时不会执行，下次运行自动补齐。系统定时器中不依赖 npm 或交互 shell 的 PATH。生产网站需在采集后同步 `review.json` 和 `sources.json` 到部署目录，或重新构建；本地开发模式直接读取 `public/data/`。

## 6. 测试与参考

```bash
npm run review:test
npm run test:unit -- --run
npm run type-check
npm run build-only
```

覆盖精确价格舍入、历史 ST、IPO 前 5 日、停牌、跨窗口连板、空样本、完整源切换、日历三级备用、熔断、日期错位、40 日初始化、增量去重、事务回滚。全仓库 lint 有既有备份文件问题，本次改动文件单独检查。

官方参考（以供应商最新说明为准）：

- [BaoStock 平台及匿名免费使用说明](https://www.baostock.com/mainContent?file=home.md)
- [BaoStock 每日全市场行情 API](https://www.baostock.com/mainContent?file=DailyUpdates.md)
- [BaoStock 历史 K 线及除权昨收定义](https://www.baostock.com/mainContent?file=stockKData.md)
- [AKShare 官方东方财富股池适配器](https://github.com/akfamily/akshare/blob/main/akshare/stock_feature/stock_ztb_em.py)
- [AKShare 官方腾讯历史行情适配器](https://github.com/akfamily/akshare/blob/main/akshare/stock_feature/stock_hist_tx.py)
- [Tushare 收盘池（仅保留可选适配）](https://tushare.pro/document/2?doc_id=298)

- [深交所涨跌幅价格计算及最小报价单位说明](https://investor.szse.cn/knowledge/stock/deal/t20180801_553961.html)
- [主板注册制前 5 日及后续 10% 涨跌幅说明](https://investor.sse.org.cn/knowledge/qa/t20230306_599093.html)
