# 设备型号转换

脚本入口：[convert-device-models.mjs](./convert-device-models.mjs)。
当前初始化数据、备份路径及旧新 ID 映射见 [2026 初始化报告](./初始化报告.2026.json)。
转换规则以 [ag.md](./ag.md) 为准。

内管导入功能的前后端及异常处理要求见 [设备型号导入功能需求](./设备型号导入功能需求.md)。

```bash
# 备份、归档全部已处理数据，重建唯一初始化 Excel 和 SQL，ID 从 26000001 起
npm run device-models -- --offline --initialize --month 2026-10

# 备份本地 models.csv，下载最新源数据，生成当前月份的 Excel 和 SQL
npm run device-models

# 指定月份，ID 使用该月份的 yyMM 前缀
npm run device-models -- --month 2026-10

# 只预览最新源数据的增量统计，不修改任何文件
npm run device-models -- --dry-run

# 离线使用本地 CSV
npm run device-models -- --offline

# 名称规则变更后，更新指定输出月份已有名称并同步 SQL（先备份，不改变 ID、型号和品牌）
npm run device-models -- --month 2026-10 --normalize-current-month

# 重新筛选指定月份已有记录，移出非 mob/pad、排除名称及源中不存在的型号，保留剩余 ID
npm run device-models -- --offline --month 2026-07 --revalidate-current-month

# 按最新规则处理初始 Excel 和所有月份文件，统一品牌、筛选和去重，重建各自 SQL
npm run device-models -- --revalidate-all

# 全量预览，不备份、不修改任何文件
npm run device-models -- --offline --revalidate-all --dry-run

# 查看自定义路径、下载地址和 SQL 批量条数等参数
npm run device-models -- --help
```

脚本沿用现有 `@oai/artifact-tool` Excel 读写依赖；运行环境需能解析该包
（当前 Codex 环境已通过 `node_modules/@oai/artifact-tool` 链接提供）。

- 默认从 [MobileModels-csv](https://github.com/KHwang9883/MobileModels-csv/blob/main/models.csv)
  的 GitHub Raw 地址下载，60 秒超时。原 CSV 先备份到 `modelBak/models.csv.yyyyMMddHHmmss.UUID.bak`。
  CSV、Excel、SQL 备份及变更报告统一使用北京时间的 14 位时间戳，例如 `20261022141438`；
  保留 UUID 防止同一秒内重名覆盖。已有历史备份文件名保持原样。
  下载失败、HTTP 错误、缺少必需字段或空数据时停止，原 CSV 保留。
  Node 直接连接失败时会尝试系统 `curl`，以兼容代理环境。
  默认 GitHub Raw 地址无法连接时，改用 GitHub 官方 Contents API 的 raw 响应获取同一仓库
  `main/models.csv`，再次下载失败或 CSV 校验失败仍停止。自定义 `--source-url` 不会切换数据来源。
- 常规增量模式保持初始文件 `设备型号转译.xlsx` 原样。读取初始文件和所有
  `设备型号转译.YYYY-MM.xlsx`，按 `YC_MODEL` 排除已知型号。同月重复运行只追加新型号，
  SQL 始终对应该月份 Excel 的完整增量；重复执行 SQL 会重复插入，请按月导入一次。
  如果没有新增型号，不创建空的月份 Excel/SQL。
- `--initialize` 按源 CSV 和当前名称规则重新生成唯一的 `设备型号转译.xlsx` 与
  `yc_DeviceModelIntoName.sql`；两个文件使用一致的 `yy00` 加四位序号 ID，2026 年为
  `26000001` 起。年份取当前北京时间月份，也可以通过 `--month` 指定；该操作会重新编号已有记录。
  初始化需要现有初始 Excel 作为字段及样式模板。结果为空或超过 9999 条时停止。
  全部输出先暂存，随后把初始、月份 Excel/SQL 和历史校验/初始化报告备份到
  `modelBak/initialize.时间戳.UUID/files/`，另存源 CSV、名称覆盖配置和 `manifest.json`。
  完整备份后发布初始化文件，移除旧月份文件及历史报告；发布失败时恢复备份。
  当前目录的 `初始化报告.YYYY.json` 包含备份路径、筛选统计、待确认名称、冲突及旧新 ID 映射。
  `--dry-run` 仅预览，不能与其他清洗模式或自定义输出路径同时使用。
- 默认月份按北京时间生成，也可通过 `--month YYYY-MM` 指定。输出为
  `设备型号转译.YYYY-MM.xlsx` 和 `yc_DeviceModelIntoName.YYYY-MM.sql`。
- 新 ID 为 `yyMM0001` 起的 8 位数字，读取所有文件中相同月份前缀的最大序号后续号，
  超过 9999 时停止。
- 只接受 `mob` 和 `pad`；名称含电脑、笔记本、游戏本、MagicBook、MateBook、翻译机、
  座舱、汽车、四足机器人的记录会被过滤。Apple 使用 `code_alias`，其他品牌使用 `model`；
  同一型号保留源文件中第一条符合条件的记录。
- 品牌列固定统一为：华为→`HUAWEI`、荣耀→`HONOR`、索尼→`Sony`、三星→`Samsung`、小米→`Xiaomi`、红米→`REDMI`。
  其他品牌优先目标文件已有英文名，其次源数据英文 `brand_title`；无确认英文显示名时保留目标规范。
  不根据设备名称中的 REDMI 自动拆分源文件归属 Xiaomi 的品牌。
  realme、360、努比亚、vivo、索尼的名称补全规则同时适用于手机和平板，匹配英文时忽略大小写。
- 名称先按 `/` 取第一段并去除首尾空格，再执行品牌名称规则。
  名称中的 `HONOR`、`HUAWEI` 分别替换成 `荣耀`、`华为`，忽略大小写，品牌列仍为英文。
  Xiaomi（以及历史小米/红米品牌）名称中的 `Xiaomi` 转成 `小米`，`REDMI/Redmi` 转成 `红米`，
  `小米 Pad`、`红米 Pad` 分别统一为 `小米平板`、`红米平板`。
  匹配时忽略大小写；品牌列按前述规范保存。名称从当前源文件重新获取，不对其他文字做全文翻译。
  realme GT 数字系列统一为 `GT 7`、`GT 7T` 格式；统一 `realme`、`vivo`、`iQOO`、`Nubia`、`Sony` 的写法。
  努比亚、索尼分别转换为 `Nubia`、`Sony`，缺少 Sony 时补 `Sony ` 前缀。
  连续空白压缩成一个空格；第一段为空的记录跳过。排除关键词仍检查源完整名称，避免分割隐藏不合规内容。
- 人工完整名称覆盖保存在 [nameOverrides.json](./nameOverrides.json)，默认是空数组。
  每项包含字符串 `brand`、`model`、`name`，按规范品牌和型号匹配，重复键或不合规名称报错。
  支持 `--name-overrides <path>` 指定其他配置。人工覆盖优先于普通词替换、系列和前缀规则，
  仍遵循名称中的 HONOR/HUAWEI 中文化，以及类型、排除词、空白和未知名称校验。
- 未知机型、未知型号、unknown、N/A 等无有效覆盖的名称跳过新增；重新筛选模式会移出已有记录并保留明细。
  仅名称规范化模式遇到无法确认的名称会停止并提示重新筛选。
  Pro、Ultra、5G、芯片、尺寸、代数等版本信息保留；词序或大小写疑似别名仅报告，不自动合并。
- 默认只对新增记录应用名称规则。`--normalize-current-month` 可按最新源名称更新当前输出月份的
  已有记录名称；源中无对应型号时规范化现有名称。修改前将原 Excel 与已有 SQL 备份到该文件
  同目录的 `modelBak/`。保留 ID、型号和品牌，不修改初始文件或其他月份；`--dry-run` 不写入或备份。
  已入库月份的名称更新属于单独的数据修正，按内管“只新增”规则重新导入不会覆盖数据库名称。
- `--revalidate-current-month` 按当前 CSV 重新筛选当前输出月份已有记录，同时规范名称。
  只保留源中可验证为 `mob`、`pad` 且符合名称规则的型号；源中查不到的记录也移出，避免将未知类型当作手机。
  同一型号任一 `mob`、`pad` 源名称命中排除关键词时，该型号整体排除，英文别名不能绕过过滤；新增记录也遵循此规则。
  修改前备份 Excel 和 SQL，并在 `modelBak` 保存 `.filtered-rows.json` 移出明细，含原 ID、型号、名称、源类型及原因。
  保留剩余 ID（允许空号），不修改初始文件或其他月份；`--dry-run` 只统计，不写出或备份。
- 每次输出源 `dtype` 分布和筛选数量；只接受 `mob`、`pad`，`mod` 不属于手机类型。
  CSV 中完全没有这两种类型时停止，避免源类型变化导致错误的零增量结果。
- `--revalidate-all` 全量处理初始 Excel 和目录下所有月份 Excel，按“初始文件优先、月份从早到晚”
  保留每个型号第一次出现的记录；过滤类型、排除词和源中不存在的型号，同时统一品牌和名称。
  全部文件先校验及暂存，再备份原 Excel／SQL 后发布，并在 `modelBak/revalidate-all.yyyyMMddHHmmss.UUID.json`
  保存品牌变更、名称变更、移出明细及备份路径。原始 CSV 及历史备份不做品牌改写。
  报告的 `sourceAudit` 包含源类型分布、允许/排除的唯一型号数量、跨品牌同型号及源名称，
  `pendingNames` 为待确认名称，`suspectedAliases` 为同品牌词序疑似别名；dry-run 同样输出完整审核信息。
  跨品牌冲突遵循已有目标品牌，规范名称时优先选择同品牌源记录；新增型号仍保留首条合规记录。
  保留所有剩余记录原 ID；初始文件的历史短 ID 保留，月份文件仍须是与文件月份一致的 8 位 ID。
  初始文件生成 `yc_DeviceModelIntoName.sql`，月份文件生成对应年月 SQL；全量模式不追加新型号。
  全量更新后运行 `npm run device-models -- --offline`，将尚未收录的型号追加到当前月份。
- Excel 沿用初始文件的字段顺序和表格格式。`YC_CREATEDDATE` 留空；SQL 使用 `NULL`，
  全量校验时将历史数字型 `YC_MODEL` 规范为文本，型号作为标识符保存；报告中统计 `normalizedModels`。
  默认每 200 条一个批量 INSERT，并转义名称、型号和品牌中的引号及反斜杠。
  读取 Excel 和导出 SQL 均忽略全空数据行（包括表格范围残留的空白行），过滤后再分批。
  非空行若缺少 ID、名称、型号或品牌，则停止导出，禁止生成 ID 为 0 或必填字段为 NULL 的记录。
- `--output` 可以指定其他输出目录；仍会扫描初始文件目录和输出目录中的月份文件。
  请顺序执行脚本，避免两个进程同时写入相同月份。

测试：`npm run test:unit -- --run src/scripts/__tests__/deviceModels.spec.ts`。
