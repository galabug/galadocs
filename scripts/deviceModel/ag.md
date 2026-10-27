# 手机型号转换需求

本文件是 scripts/deviceModel/convert-device-models.mjs 的规则依据，改动需同步到脚本、测试和 README。

## 文件与执行流程

- 源文件：scripts/deviceModel/models.csv。
- 源地址：https://github.com/KHwang9883/MobileModels-csv/blob/main/models.csv。
- 初始文件：scripts/deviceModel/设备型号转译.xlsx。
- 月份文件：设备型号转译.YYYY-MM.xlsx；SQL：yc_DeviceModelIntoName.YYYY-MM.sql。
- 默认先备份本地 CSV 到 modelBak/，下载并验证新 CSV 后替换；失败时停止，不静默使用旧数据。
  默认 Raw 地址无法连接时可回退至同仓库官方 API。
- 常规模式读取初始及所有月份文件，仅追加尚未存在的型号，同月继续追加。
- --revalidate-all 先备份再更新全部 Excel 和 SQL，保留原 ID，不追加新型号；
  随后运行 --offline 补充当前月份新增。
- --offline 使用本地 CSV；--dry-run 只预览，不修改数据文件或备份。
- --initialize 从源数据按全部当前规则重建唯一的设备型号转译.xlsx 和 yc_DeviceModelIntoName.sql。
  初始化 ID 使用年份后两位加 00 加四位序号，2026 年为 26000001 起；Excel 和 SQL ID 一致。
  年份取北京时间当前月份，支持 --month 指定年份。超过 9999 条或结果为空时停止。
  发布前备份所有已处理的 Excel、SQL、历史校验/初始化报告，并保存源 CSV、覆盖表和旧新 ID 映射。
  备份完成后清理月份文件和历史报告；发布失败恢复已备份数据。
- 没有新增型号时，不创建空的月份 Excel/SQL。
- 月份及备份时间使用北京时间，历史备份不参与去重。

## 类型、型号及 ID

- 仅接受 dtype 为 mob、pad，mod、computer、watch 等均排除。
- 在名称分割前检查完整源名称，过滤关键词：电脑、笔记本、游戏本、MagicBook、
  MateBook、翻译机、座舱、汽车、四足机器人。英文忽略大小写。
  同一型号任一 mob/pad 别名命中时整体排除，人工覆盖不能绕过类型和源名称排除。
- Apple 的型号取 code_alias，其他品牌取 model，型号始终以文本保存，保留前导零。
- 全局按型号去重，不按名称去重。初始文件优先，月份从早到晚保留第一条。
  新型号取源文件第一条合规记录；不同型号可对应同一商品名。
- 新 YC_ID 为 yyMM 加四位序号，从所有文件中该前缀的最大序号续号，超过 9999 则停止。
  历史 ID 保留，不因名称修订重新编号。
- 全量校验移出源中不存在、类型不符、名称不合规的记录，并保存原因。

## 品牌列与设备名称分开规范

- YC_BRAND 优先沿用目标已有英文名，其次采用源英文显示名，无确认英文显示名时保留原规范。
- 固定品牌映射：华为→HUAWEI、荣耀→HONOR、索尼→Sony、三星→Samsung、小米→Xiaomi。
  历史红米品牌统一为 REDMI，不按名称中的红米拆分源 Xiaomi 品牌。
- 同型号跨品牌时保留已有目标品牌，优先采用同品牌源名称，列入复核清单。
- YC_NAME 的中文品牌不改变 YC_BRAND。

## 名称处理顺序及风格

1. 先校验类型和完整源名称排除词。
2. 按规范品牌与型号查询 nameOverrides.json 人工完整名称覆盖。
3. 按 / 只取第一段，清除首尾空白，连续空白压缩成一个半角空格。
4. 未知名称进入待确认清单，不作为新增型号发布。
5. 按下表统一品牌词和系列格式，再补必要品牌前缀。
6. 保留版本、芯片、尺寸、代数和地区信息，不猜测名称或合并市场版本。

人工覆盖优先于普通系列词与前缀规则，但仍需通过基本清洗、未知名称和排除词检查。
品牌中文化只匹配清理后的名称开头，忽略英文大小写；品牌词在名称中间或末尾时保持原文，
不得全文替换，也不应为了中文化给已有品牌词的联名名称额外添加中文前缀。
该位置约束同样适用于人工覆盖。YC_BRAND 的既有规范不受名称位置影响。

早期荣耀机型的两个完整名称单独规范：荣耀 Honor→荣耀、荣耀 Honor+→荣耀+，
忽略 Honor 大小写，保留加号；开头 HONOR 中文化后产生的同类名称也适用。
此规则在品牌中文化之后执行，人工覆盖同样适用，只匹配完整名称，不改写
PORSCHE DESIGN HONOR 等联名名称，也不扩展匹配荣耀 Honor 8 等其他名称。

| 适用范围                | YC_NAME 规则                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| 所有设备                | 名称开头的 HONOR→荣耀、HUAWEI→华为，忽略大小写；中间和末尾保持英文                     |
| HONOR / HUAWEI          | 名称任意位置已含对应中英文品牌时不补前缀；完全缺少品牌才补“荣耀 ”或“华为 ”             |
| Xiaomi / 历史小米、红米 | 名称开头的 Xiaomi→小米、REDMI/Redmi→红米；仅开头的小米 Pad→小米平板、红米 Pad→红米平板 |
| realme                  | 真我→realme，统一 realme 大小写；缺少品牌补 realme 前缀；GT 数字系列统一为 GT 7、GT 7T |
| 360                     | 缺少 360 时补“360 ”                                                                    |
| Nubia / 努比亚          | nubia/努比亚统一为 Nubia；含红魔或 REDMAGIC 时保留子系列，否则缺少品牌补“Nubia ”       |
| vivo                    | 统一 vivo、iQOO 大小写，含 iQOO 时不补 vivo，否则缺少品牌补“vivo ”                     |
| Sony                    | sony/索尼统一为 Sony，缺少品牌补“Sony ”，避免 Sony 索尼双前缀                          |
| 其他品牌                | 沿用目标及可辨识系列名称风格，不给 iPhone、Pixel、Galaxy 等重复补厂商品牌              |

Apple 设备名称括号内的“第 N 代”（N 为阿拉伯数字，允许词间空格）改为系列名称后的
空格加数字：iPad Air (第3代)→iPad Air 3、iPhone SE (第 2 代)→iPhone SE 2。
若同一括号含尺寸等信息，以英文或中文逗号分隔，移出代数后保留其余信息，括号紧跟数字：
iPad Pro (12.9 英寸, 第 3 代)→iPad Pro 3(12.9英寸)。支持中英文括号、逗号，
仅在发生代数转换时去除尺寸数字与“英寸”间的空格，括号后的版本文字保持原文。
没有明确数字代数的名称保持不变，不推测代数、不修正系列拼写、不改 YC_MODEL 和 YC_ID。
此项属于普通系列格式规则，人工完整名称覆盖仍优先；非 Apple 品牌不适用。

只对明确系列应用空格规则，不给所有字母数字之间插空格，不全局改英文大小写。
Pro、Ultra、5G、4G、芯片、尺寸、代数及 Nothing Phone 括号等辨识信息不可任意删除。

位置规则示例：HONOR Magic8→荣耀 Magic8、HUAWEI Mate 80→华为 Mate 80、
Xiaomi 17 Ultra→小米 17 Ultra；PORSCHE DESIGN HONOR Magic V2 RSR、
PORSCHE DESIGN HUAWEI Mate RS、Leica Leitzphone powered by Xiaomi 均保持原文。

## 人工覆盖与异常报告

- nameOverrides.json 为 JSON 数组，每项包含非空字符串 brand、model、name。
  品牌使用规范品牌或可解析别名，按“品牌＋型号”匹配，重复键及非法名称必须报错。
  支持 --name-overrides 指定其他 JSON 文件。
- 默认覆盖表为空，只有人工确认过的完整名称才加入。
  联名名称如 Leica Leitzphone powered by Xiaomi 已由位置规则保护，无需专门覆盖；
  只有源名称与已确认正式名称不一致的情况才需要人工覆盖。
- 未知机型、未知型号、未知设备、unknown、unknown model、unknown device、N/A
  等占位名称进入待确认清单，记录品牌、型号、源名称；有效人工覆盖可恢复导出。
- 全量重新筛选移出未知名称；仅规范名称模式遇到未知名称应停止并提示使用重新筛选模式。
- 同品牌名称仅词序或大小写不同，如“小米 11 Lite 5G NE”与“小米 11 Lite NE 5G”，
  列为疑似别名，不自动调整词序或合并版本。
- 报告包含类型分布、排除数量、跨品牌冲突、未知名称、疑似别名。
  常规运行输出摘要，全量校验保存完整 JSON；dry-run 显示完整审核信息。

## SQL 与验证

- 每个 SQL 对应其 Excel 的全部有效记录，默认每 200 条 INSERT，末批可不足 200 条。
- 固定字段：YC_ID,YC_CREATEDDATE,YC_NAME,YC_MODEL,YC_BRAND。
- 新记录日期留空，SQL 为 NULL；正确转义引号、反斜杠。
- 示例：insert into yc_DeviceModelIntoName (YC_ID,YC_CREATEDDATE,YC_NAME,YC_MODEL,YC_BRAND) values (26070001,NULL,'iPhone 7 Plus','iPhone9,2','Apple');
- 忽略全空行，拒绝必填项缺失，校验型号与 ID 冲突。
- 测试覆盖：重复规范化稳定、英文品牌列保留、未知名称与人工覆盖、
  类型过滤不能绕过、版本信息保留、历史与增量规则一致、重复运行无重复新增。
