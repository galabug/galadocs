#!/usr/bin/env node
// node scripts/deviceModel/convert-device-models.mjs --month 2026-07

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'
import {
  cleanDeviceName,
  findNameAliasCandidates,
  isUnknownName,
  nameOverrideKey,
  normalizeNameStyle,
  selectDeviceName,
} from './nameRules.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..')
const DEVICE_MODEL_DIR = SCRIPT_DIR
const DEFAULT_SOURCE = path.join(DEVICE_MODEL_DIR, 'models.csv')
const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/KHwang9883/MobileModels-csv/main/models.csv'
const GITHUB_API_SOURCE_URL =
  'https://api.github.com/repos/KHwang9883/MobileModels-csv/contents/models.csv?ref=main'
const DEFAULT_TARGET = path.join(DEVICE_MODEL_DIR, '设备型号转译.xlsx')
const DEFAULT_NAME_OVERRIDES = path.join(DEVICE_MODEL_DIR, 'nameOverrides.json')
const DEFAULT_OUTPUT_STEM = '设备型号转译'
const DEFAULT_SQL_STEM = 'yc_DeviceModelIntoName'
const DEFAULT_SQL_BATCH_SIZE = 200
const DEFAULT_SHEET = '设备型号转译'
const ALLOWED_DTYPES = new Set(['mob', 'pad'])
const EXCLUDED_NAME_KEYWORDS = [
  '电脑',
  '笔记本',
  '游戏本',
  'magicbook',
  'matebook',
  '翻译机',
  '座舱',
  '汽车',
  '四足机器人',
]
const BRAND_NAME_OVERRIDES = new Map([
  ['huawei', 'HUAWEI'],
  ['华为', 'HUAWEI'],
  ['honor', 'HONOR'],
  ['荣耀', 'HONOR'],
  ['sony', 'Sony'],
  ['索尼', 'Sony'],
  ['samsung', 'Samsung'],
  ['三星', 'Samsung'],
  ['xiaomi', 'Xiaomi'],
  ['小米', 'Xiaomi'],
  ['redmi', 'REDMI'],
  ['红米', 'REDMI'],
])
const GENERIC_NAME_TOKENS = new Set([
  '手机',
  '智能手机',
  '游戏手机',
  '平板',
  'pad',
  'phone',
  'mobile',
  'smartphone',
  'tablet',
])
const execFileAsync = promisify(execFile)

function printHelp() {
  console.log(`用法:
  node scripts/deviceModel/convert-device-models.mjs [选项]

默认行为:
  - 将本地 models.csv 备份到同目录的 modelBak/，下载并校验 GitHub 最新 CSV 后替换本地文件
  - 下载或校验失败立即停止，保留原 CSV；不会静默使用旧数据
  - 常规模式不修改初始文件；--revalidate-all 会先备份再更新初始文件及所有月份文件
  - 读取初始文件和目录下全部设备型号转译.YYYY-MM.xlsx作为已知型号
  - 只保留 dtype 为 mob 或 pad 的记录；名称含电脑、笔记本、游戏本、MagicBook、MateBook、翻译机、座舱、汽车、四足机器人的记录过滤掉
  - Apple 使用 code_alias 作为 YC_MODEL，其他品牌使用 model 作为 YC_MODEL
  - YC_MODEL 全局去重，并排除初始文件和历史月份文件中已经存在的型号
  - 品牌优先使用目标已有英文名，其次源英文显示名；指定的六项映射优先
  - 明确统一 华为→HUAWEI、荣耀→HONOR、索尼→Sony、三星→Samsung、小米→Xiaomi、红米→REDMI
  - 手机名称无法辨识品牌时，在名称前添加品牌名
  - 手机和 pad 的名称规则都适用：realme 名称中的“真我”替换为“realme”，缺少 realme 时补“realme ”前缀
  - 手机和 pad 的 Nubia（努比亚）名称缺少品牌名或红魔时补“品牌名 ”前缀
  - 手机和 pad 的 360 名称缺少“360”时补“360 ”前缀
  - 手机和 pad 的 vivo 名称缺少“vivo”或“IQOO”时补“vivo ”前缀
  - 手机和 pad 的 Sony 名称缺少 sony（忽略大小写）时补“Sony ”前缀
  - Xiaomi 设备名称中的 Xiaomi 替换成小米，REDMI/Redmi 替换成红米（忽略大小写）
  - 名称中的 HONOR/HUAWEI 统一为荣耀/华为，品牌列仍为英文
  - 小米/红米 Pad 统一为小米平板/红米平板，realme GT 数字系列统一空格
  - 所有名称按 / 取第一段并清理空白；未知名称待确认，支持按品牌和型号人工覆盖
  - 月份文件只保存本次新增型号；同月重复执行会继续追加到同一个月份文件
  - 同时生成 TiDB 插入 SQL：scripts/deviceModel/yc_DeviceModelIntoName.YYYY-MM.sql
  - SQL 默认每 ${DEFAULT_SQL_BATCH_SIZE} 条组成一个批量 INSERT，不修改初始文件

选项:
  --source <path>   指定源 CSV
  --source-url <url> 指定 CSV 下载地址；默认 GitHub Raw 地址
  --name-overrides <path> 人工完整名称覆盖 JSON，默认 scripts/deviceModel/nameOverrides.json
  --offline         跳过备份和下载，直接使用本地 CSV
  --normalize-current-month 按最新规则更新当前输出月份已有记录的名称；先备份，不改变 ID、型号和品牌
  --revalidate-current-month 重新筛选当前月份已有记录并规范名称；移除不合规或源中查不到的型号，备份并保存移出明细
  --revalidate-all   重新筛选初始及所有月份文件，统一品牌和名称、全局去重并重建各自 SQL；保留原 ID，不追加新型号
  --initialize      备份并移除已有 Excel/SQL，按源数据重建唯一初始 Excel/SQL，ID 为 yy00 加四位序号
  --target <path>   指定固定初始目标 Excel
  --output <path>   指定月份增量文件；默认按月份命名
  --sql-output <path> 指定 TiDB SQL 文件；默认按月份命名
  --sql-batch-size <n> SQL 每批插入条数；默认 ${DEFAULT_SQL_BATCH_SIZE}
  --month <month>   指定输出月份，格式 YYYY-MM
  --sheet <name>    指定目标工作表；默认“设备型号转译”
  --dry-run         下载并统计，不备份、不修改 CSV、不写出 Excel/SQL
  --help            显示帮助
`)
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    sourceUrl: DEFAULT_SOURCE_URL,
    nameOverrides: DEFAULT_NAME_OVERRIDES,
    offline: false,
    normalizeCurrentMonth: false,
    revalidateCurrentMonth: false,
    revalidateAll: false,
    initialize: false,
    target: null,
    output: null,
    sqlOutput: null,
    sqlBatchSize: DEFAULT_SQL_BATCH_SIZE,
    month: null,
    sheet: DEFAULT_SHEET,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--offline') {
      options.offline = true
      continue
    }
    if (arg === '--normalize-current-month') {
      options.normalizeCurrentMonth = true
      continue
    }
    if (arg === '--revalidate-current-month') {
      options.revalidateCurrentMonth = true
      continue
    }
    if (arg === '--revalidate-all') {
      options.revalidateAll = true
      continue
    }
    if (arg === '--initialize') {
      options.initialize = true
      continue
    }

    const option = {
      '--source': 'source',
      '--source-url': 'sourceUrl',
      '--name-overrides': 'nameOverrides',
      '--target': 'target',
      '--output': 'output',
      '--sql-output': 'sqlOutput',
      '--sql-batch-size': 'sqlBatchSize',
      '--month': 'month',
      '--sheet': 'sheet',
    }[arg]
    if (!option) {
      throw new Error(`未知选项：${arg}。使用 --help 查看用法。`)
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`选项 ${arg} 缺少参数。`)
    }
    if (option === 'sqlBatchSize') {
      const batchSize = Number(value)
      if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error(`SQL 批量条数必须是正整数，当前值：${value}`)
      }
      options[option] = batchSize
    } else {
      options[option] = value
    }
    index += 1
  }

  return options
}

function resolvePath(filePath) {
  return path.resolve(REPO_ROOT, filePath)
}

function asText(value) {
  return value == null
    ? ''
    : String(value)
        .replace(/^\uFEFF/, '')
        .trim()
}

function normalizeHeader(value) {
  return asText(value).toLowerCase()
}

function makeHeaderMap(headerRow, label) {
  const headerMap = new Map()
  headerRow.forEach((value, index) => {
    const header = normalizeHeader(value)
    if (header) headerMap.set(header, index)
  })
  if (headerMap.size === 0) throw new Error(`${label}没有可用表头。`)
  return headerMap
}

function requireHeaders(headerMap, requiredHeaders, label) {
  const missing = requiredHeaders.filter((header) => !headerMap.has(normalizeHeader(header)))
  if (missing.length > 0) {
    throw new Error(`${label}缺少字段：${missing.join(', ')}`)
  }
}

function formatBackupTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return ['year', 'month', 'day', 'hour', 'minute', 'second']
    .map((type) => parts.find((part) => part.type === type).value)
    .join('')
}

function localMonthString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`
}

function validateMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`月份格式必须是 YYYY-MM，当前值：${value}`)
  }
  return value
}

function isApple(row, indexes) {
  return [row[indexes.brand], row[indexes.brandTitle]].some(
    (value) => asText(value).toLowerCase() === 'apple',
  )
}

function normalizeBrandKey(value) {
  return asText(value).toLowerCase()
}

function countValues(values) {
  const counts = new Map()
  for (const value of values) {
    const normalized = asText(value)
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return counts
}

function chooseMostFrequent(values, fallback = '') {
  const counts = countValues(values)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? fallback
}

function isEnglishBrand(value) {
  return /[A-Za-z]/.test(value) && !/[\u3400-\u9fff]/.test(value)
}

function buildBrandContext(sourceRows, sourceIndexes, targetRows, targetIndexes, overrides = []) {
  const targetBrandCounts = countValues(targetRows.map((row) => row[targetIndexes.brand]))
  const targetBrands = [...targetBrandCounts.keys()]
  const groups = new Map()

  for (const row of sourceRows) {
    const rawBrand = asText(row[sourceIndexes.brand])
    const rawBrandTitle = asText(row[sourceIndexes.brandTitle])
    const key = normalizeBrandKey(rawBrand) || normalizeBrandKey(rawBrandTitle)
    if (!key) continue

    const group = groups.get(key) ?? { aliases: new Set(), titles: [] }
    if (rawBrand) group.aliases.add(normalizeBrandKey(rawBrand))
    if (rawBrandTitle) {
      group.aliases.add(normalizeBrandKey(rawBrandTitle))
      group.titles.push(rawBrandTitle)
    }
    groups.set(key, group)
  }

  const canonicalByKey = new Map()
  const aliasesByBrand = new Map()
  const canonicalByAlias = new Map(BRAND_NAME_OVERRIDES)
  for (const [key, group] of groups) {
    const matches = targetBrands
      .filter((targetBrand) => group.aliases.has(normalizeBrandKey(targetBrand)))
      .sort(
        (left, right) => (targetBrandCounts.get(right) ?? 0) - (targetBrandCounts.get(left) ?? 0),
      )
    const explicitCanonical = [...group.aliases]
      .map((alias) => BRAND_NAME_OVERRIDES.get(alias))
      .find(Boolean)
    const englishMatch = matches.find(isEnglishBrand)
    const englishTitles = group.titles.filter(isEnglishBrand)
    const resolved =
      explicitCanonical ??
      englishMatch ??
      (chooseMostFrequent(englishTitles) || matches[0] || chooseMostFrequent(group.titles, key))
    canonicalByKey.set(key, resolved)
    for (const alias of group.aliases) canonicalByAlias.set(alias, resolved)
    const canonicalKey = normalizeBrandKey(resolved)
    const aliases = aliasesByBrand.get(canonicalKey) ?? new Set()
    for (const alias of group.aliases) aliases.add(alias)
    aliases.add(canonicalKey)
    aliasesByBrand.set(canonicalKey, aliases)
  }

  const knownNameTokensByBrand = new Map()
  for (const row of targetRows) {
    const rawBrand = asText(row[targetIndexes.brand])
    const brand = canonicalByAlias.get(normalizeBrandKey(rawBrand)) ?? rawBrand
    const nameTokens = tokenizeName(row[targetIndexes.name])
    if (!brand || nameTokens.length === 0) continue
    const tokens = knownNameTokensByBrand.get(normalizeBrandKey(brand)) ?? new Set()
    for (const token of nameTokens) {
      const normalizedToken = normalizeBrandKey(token)
      if (!isUsefulNameToken(normalizedToken)) continue
      tokens.add(normalizedToken)
    }
    knownNameTokensByBrand.set(normalizeBrandKey(brand), tokens)
  }

  if (!Array.isArray(overrides)) throw new Error('名称覆盖配置必须是 JSON 数组。')
  const nameOverrides = new Map()
  for (const entry of overrides) {
    if (
      !entry ||
      ['brand', 'model', 'name'].some((key) => typeof entry[key] !== 'string' || !entry[key].trim())
    )
      throw new Error('每条名称覆盖必须包含非空字符串 brand、model、name。')
    const brand = canonicalByAlias.get(normalizeBrandKey(entry.brand)) ?? asText(entry.brand)
    const key = nameOverrideKey(brand, entry.model)
    if (nameOverrides.has(key)) throw new Error(`重复的名称覆盖：${brand} / ${entry.model}`)
    const name = cleanDeviceName(entry.name)
    if (
      !name ||
      isUnknownName(entry.name) ||
      isUnknownName(name) ||
      hasExcludedNameKeyword(entry.name)
    ) {
      throw new Error(`名称覆盖不合规：${brand} / ${entry.model}`)
    }
    nameOverrides.set(key, name)
  }
  return { aliasesByBrand, canonicalByKey, canonicalByAlias, knownNameTokensByBrand, nameOverrides }
}

function tokenizeName(value) {
  return asText(value).match(/[A-Za-z][A-Za-z0-9+.-]*|\d+[A-Za-z]+|[\u4e00-\u9fff]{2,}/g) ?? []
}

function isModelLikeToken(value) {
  const compact = value.replace(/[\s_-]/g, '')
  return /^[a-z]{1,4}\d[a-z0-9+.-]*$/i.test(compact) || /^\d+[a-z]{1,4}$/i.test(compact)
}

function isUsefulNameToken(value) {
  return value.length >= 2 && !GENERIC_NAME_TOKENS.has(value) && !isModelLikeToken(value)
}

function hasRecognizableBrandName(name, brand, aliases, knownNameTokens) {
  const normalizedName = normalizeBrandKey(name)
  const brandNames = [brand, ...aliases].map(normalizeBrandKey).filter(Boolean)
  if (brandNames.some((alias) => normalizedName.includes(alias))) return true

  const nameTokens = new Set(tokenizeName(name).map(normalizeBrandKey))
  return [...knownNameTokens].some((token) => nameTokens.has(token))
}

function hasExcludedNameKeyword(name) {
  const normalizedName = normalizeBrandKey(name)
  return EXCLUDED_NAME_KEYWORDS.some((keyword) => normalizedName.includes(keyword))
}

function getBrandPrefixSeparator(brand, name, targetRows, targetIndexes) {
  const separators = []
  const normalizedBrand = normalizeBrandKey(brand)
  for (const row of targetRows) {
    if (normalizeBrandKey(row[targetIndexes.brand]) !== normalizedBrand) continue
    const targetName = asText(row[targetIndexes.name])
    if (!targetName || !normalizeBrandKey(targetName).startsWith(normalizedBrand)) continue
    const remainder = targetName.slice(brand.length)
    separators.push(/^\s/.test(remainder) ? ' ' : '')
  }
  if (separators.length > 0) {
    const separatorCounts = countValues(separators.map((separator) => separator || '<none>'))
    const separator = [...separatorCounts.entries()].sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0]
    return separator === '<none>' ? '' : (separator ?? ' ')
  }
  return /^(手机|智能手机|phone|smartphone|mobile)/i.test(asText(name)) ? '' : ' '
}

function normalizeModelName(name, brand, brandContext, targetRows, targetIndexes, model = '') {
  const selected = selectDeviceName(name, brand, model, brandContext)
  if (!selected.name || selected.overridden) return { ...selected, prefixed: false }
  name = normalizeNameStyle(selected.name, brand)
  const key = normalizeBrandKey(brand)
  if (
    (key === 'apple' && /^(iphone|ipad)\b/i.test(name)) ||
    (key === 'google' && /^pixel\b/i.test(name)) ||
    (key === 'samsung' && /^galaxy\b/i.test(name))
  ) {
    return { name, prefixed: false }
  }
  if (['huawei', '华为', 'honor', '荣耀'].includes(key)) {
    const displayBrand = ['huawei', '华为'].includes(key) ? '华为' : '荣耀'
    if (name.includes(displayBrand)) return { name, prefixed: false }
    return { name: `${displayBrand} ${name}`, prefixed: true }
  }
  if (['小米', 'xiaomi', '红米', 'redmi'].includes(key)) {
    const normalizedName = name
    return {
      name: normalizedName,
      prefixed: false,
      normalizedBrandName: normalizedName !== selected.name,
    }
  }
  if (key === '索尼' || key === 'sony') {
    if (/sony/i.test(name)) return { name, prefixed: false }
    return { name: `Sony ${name}`, prefixed: true }
  }
  if (key === 'realme' || key === '真我') {
    const normalizedName = name.replace(/真我/g, 'realme')
    if (normalizeBrandKey(normalizedName).includes('realme')) {
      return { name: normalizedName, prefixed: false, normalizedBrandName: normalizedName !== name }
    }
    return {
      name: `realme ${normalizedName}`,
      prefixed: true,
      normalizedBrandName: normalizedName !== name,
    }
  }
  if (key === '努比亚' || key === 'nubia') {
    if (/(努比亚|nubia|红魔|redmagic)/i.test(name)) return { name, prefixed: false }
    return { name: `Nubia ${name}`, prefixed: true }
  }
  if (key === '360') {
    if (name.includes('360')) return { name, prefixed: false }
    return { name: `${brand} ${name}`, prefixed: true }
  }
  if (key === 'vivo') {
    if (/(vivo|iqoo)/i.test(name)) return { name, prefixed: false }
    return { name: `${brand} ${name}`, prefixed: true }
  }
  const aliases = [...(brandContext.aliasesByBrand.get(key) ?? [])]
  const knownNameTokens = brandContext.knownNameTokensByBrand.get(key) ?? new Set()
  if (hasRecognizableBrandName(name, brand, aliases, knownNameTokens)) {
    return { name, prefixed: false }
  }
  const separator = getBrandPrefixSeparator(brand, name, targetRows, targetIndexes)
  return { name: `${brand}${separator}${name}`, prefixed: true }
}

function getOnlyWorksheet(workbook, sheetName) {
  try {
    return workbook.worksheets.getItem(sheetName)
  } catch {
    throw new Error(`目标文件中找不到工作表“${sheetName}”。`)
  }
}

function findDuplicateValues(rows, columnIndex) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    const value = asText(row[columnIndex])
    if (!value) continue
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function replaceTableRows(sheet, table, headerValues, rows) {
  const oldAddress = table.address
  const tableName = table.name
  const tableStyle = table.style
  const showFilterButton = table.showFilterButton
  const oldRange = sheet.getRange(oldAddress)

  table.delete()
  oldRange.clear({ applyTo: 'contents' })

  const newRange = sheet.getRangeByIndexes(0, 0, rows.length + 1, headerValues.length)
  newRange.values = [headerValues, ...rows]
  const newTable = sheet.tables.add(newRange.address, true, tableName)
  newTable.style = tableStyle
  newTable.showFilterButton = showFilterButton
  return newTable
}

function getSourceModel(row, indexes) {
  return asText(row[isApple(row, indexes) ? indexes.codeAlias : indexes.model])
}

function getExcludedSourceModels(sourceRows, indexes) {
  return new Set(
    sourceRows
      .filter(
        (row) =>
          ALLOWED_DTYPES.has(asText(row[indexes.dtype]).toLowerCase()) &&
          hasExcludedNameKeyword(row[indexes.modelName]),
      )
      .map((row) => getSourceModel(row, indexes))
      .filter(Boolean),
  )
}

function analyzeSourceModels(sourceRows, indexes, brandContext) {
  const groups = new Map()
  const pendingNames = new Map()
  const namedRecords = []
  const excluded = getExcludedSourceModels(sourceRows, indexes)
  for (const row of sourceRows) {
    if (!ALLOWED_DTYPES.has(asText(row[indexes.dtype]).toLowerCase())) continue
    const model = getSourceModel(row, indexes)
    if (!model || excluded.has(model)) continue
    const rawName = asText(row[indexes.modelName])
    if (!rawName.split('/')[0].trim()) continue
    const key = normalizeBrandKey(row[indexes.brand]) || normalizeBrandKey(row[indexes.brandTitle])
    const brand = brandContext.canonicalByKey.get(key)
    if (!brand) continue
    const selected = selectDeviceName(rawName, brand, model, brandContext)
    if (selected.unknown) {
      pendingNames.set(nameOverrideKey(brand, model), { brand, model, name: rawName })
      continue
    }
    if (!selected.name) continue
    namedRecords.push({
      brand,
      model,
      name: selected.overridden ? selected.name : normalizeNameStyle(selected.name, brand),
    })
    const group = groups.get(model) ?? { brands: new Set(), names: new Set() }
    group.brands.add(brand)
    group.names.add(rawName)
    groups.set(model, group)
  }
  return {
    dtypeCounts: Object.fromEntries(
      countValues(sourceRows.map((row) => asText(row[indexes.dtype]).toLowerCase())),
    ),
    eligibleUniqueModels: groups.size,
    excludedUniqueModels: excluded.size,
    pendingNames: [...pendingNames.values()],
    suspectedAliases: findNameAliasCandidates(namedRecords),
    ambiguousModels: [...groups]
      .filter(([, group]) => group.brands.size > 1)
      .map(([model, group]) => ({ model, brands: [...group.brands], names: [...group.names] })),
  }
}

function printNameAudit(sourceAudit, dryRun) {
  console.log(
    `待确认名称：${sourceAudit.pendingNames.length}，疑似名称别名：${sourceAudit.suspectedAliases.length} 组`,
  )
  if (dryRun) console.log(JSON.stringify({ sourceAudit }))
}

function revalidateMonthlyRows(monthlyData, sourceRows, indexes, brandContext) {
  brandContext ??= buildBrandContext(sourceRows, indexes, monthlyData.rows, monthlyData.indexes)
  const matches = new Map()
  const excluded = getExcludedSourceModels(sourceRows, indexes)
  for (const row of sourceRows) {
    const model = getSourceModel(row, indexes)
    if (!model) continue
    const group = matches.get(model) ?? []
    group.push(row)
    matches.set(model, group)
  }
  const rows = []
  const removedRows = []
  for (const row of monthlyData.rows) {
    const model = asText(row[monthlyData.indexes.model])
    const group = matches.get(model) ?? []
    const allowed = group.filter((sourceRow) =>
      ALLOWED_DTYPES.has(asText(sourceRow[indexes.dtype]).toLowerCase()),
    )
    let reason
    if (group.length === 0) reason = 'SOURCE_MODEL_NOT_FOUND'
    else if (allowed.length === 0) reason = 'DTYPE_NOT_ALLOWED'
    else if (excluded.has(model)) reason = 'EXCLUDED_NAME_KEYWORD'
    else if (
      !allowed.some(
        (sourceRow) =>
          asText(sourceRow[indexes.modelName]).split('/')[0].trim() &&
          (asText(sourceRow[indexes.brand]) || asText(sourceRow[indexes.brandTitle])),
      )
    )
      reason = 'INVALID_SOURCE_RECORD'
    else if (
      !allowed.some(
        (sourceRow) =>
          selectDeviceName(
            sourceRow[indexes.modelName],
            row[monthlyData.indexes.brand],
            model,
            brandContext,
          ).name,
      )
    )
      reason = 'UNKNOWN_NAME'
    if (!reason) {
      rows.push(row)
      continue
    }
    removedRows.push({
      id: row[monthlyData.indexes.id],
      model,
      brand: row[monthlyData.indexes.brand],
      name: row[monthlyData.indexes.name],
      reason,
      sourceDtypes: [...new Set(group.map((sourceRow) => asText(sourceRow[indexes.dtype])))],
      sourceNames: [...new Set(group.map((sourceRow) => asText(sourceRow[indexes.modelName])))],
    })
  }
  return { rows, removedRows }
}

function buildNewRecords(sourceRows, sourceIndexes, targetRows, targetIndexes, brandContext) {
  const excludedModels = getExcludedSourceModels(sourceRows, sourceIndexes)
  const targetModels = new Set(
    targetRows.map((row) => asText(row[targetIndexes.model])).filter(Boolean),
  )
  const sourceModels = new Set()
  const stats = {
    sourceRows: sourceRows.length,
    allowedRows: 0,
    skippedOtherDtype: 0,
    skippedExcludedName: 0,
    skippedMissingBrand: 0,
    skippedAppleMissingCodeAlias: 0,
    skippedMissingModel: 0,
    skippedMissingName: 0,
    skippedUnknownName: 0,
    skippedSourceDuplicate: 0,
    skippedExistingTarget: 0,
    prefixedBrandNames: 0,
    normalizedSpecialBrandNames: 0,
    newRows: 0,
  }
  const newRecords = []

  for (const row of sourceRows) {
    const dtype = asText(row[sourceIndexes.dtype]).toLowerCase()
    if (!ALLOWED_DTYPES.has(dtype)) {
      stats.skippedOtherDtype += 1
      continue
    }
    stats.allowedRows += 1

    const brandKey =
      normalizeBrandKey(row[sourceIndexes.brand]) ||
      normalizeBrandKey(row[sourceIndexes.brandTitle])
    const brand =
      brandContext.canonicalByKey.get(brandKey) ||
      asText(row[sourceIndexes.brandTitle]) ||
      asText(row[sourceIndexes.brand])
    if (!brand) {
      stats.skippedMissingBrand += 1
      continue
    }

    const apple = isApple(row, sourceIndexes)
    const model = apple ? asText(row[sourceIndexes.codeAlias]) : asText(row[sourceIndexes.model])
    if (!model) {
      if (apple) stats.skippedAppleMissingCodeAlias += 1
      else stats.skippedMissingModel += 1
      continue
    }

    const rawName = asText(row[sourceIndexes.modelName])
    if (hasExcludedNameKeyword(rawName) || excludedModels.has(model)) {
      stats.skippedExcludedName += 1
      continue
    }
    const normalizedName = normalizeModelName(
      rawName,
      brand,
      brandContext,
      targetRows,
      targetIndexes,
      model,
    )
    const name = normalizedName.name
    if (!name) {
      if (normalizedName.unknown) stats.skippedUnknownName += 1
      else stats.skippedMissingName += 1
      continue
    }
    if (sourceModels.has(model)) {
      stats.skippedSourceDuplicate += 1
      continue
    }
    sourceModels.add(model)
    if (targetModels.has(model)) {
      stats.skippedExistingTarget += 1
      continue
    }

    newRecords.push({ brand, model, name, prefixedBrandName: normalizedName.prefixed })
    if (normalizedName.prefixed) stats.prefixedBrandNames += 1
    if (normalizedName.normalizedBrandName) stats.normalizedSpecialBrandNames += 1
    stats.newRows += 1
  }

  return { newRecords, stats, targetModels }
}

function getMonthIdPrefix(month) {
  const [year, monthNumber] = month.split('-')
  return `${year.slice(-2)}${monthNumber}`
}

function getNextMonthSequence(rows, idIndex, month) {
  const prefix = getMonthIdPrefix(month)
  return (
    rows.reduce((maxSequence, row) => {
      const id = asText(row[idIndex])
      if (!new RegExp(`^${prefix}\\d{4}$`).test(id)) return maxSequence
      return Math.max(maxSequence, Number(id.slice(4)))
    }, 0) + 1
  )
}

function toMonthTargetRows(records, targetIndexes, month, startSequence, columnCount) {
  const prefix = getMonthIdPrefix(month)
  return toTargetRows(records, targetIndexes, prefix, startSequence, columnCount)
}

function toTargetRows(records, targetIndexes, prefix, startSequence, columnCount) {
  return records.map((record, offset) => {
    const sequence = startSequence + offset
    if (sequence > 9999) {
      throw new Error(`前缀 ${prefix} 的 YC_ID 序号已超过 9999，无法继续生成 8 位 ID。`)
    }
    const row = Array.from({ length: columnCount }, () => null)
    row[targetIndexes.id] = Number(`${prefix}${String(sequence).padStart(4, '0')}`)
    row[targetIndexes.createdDate] = null
    row[targetIndexes.brand] = record.brand
    row[targetIndexes.model] = record.model
    row[targetIndexes.name] = record.name
    return row
  })
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function saveWorkbook(workbook, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  try {
    workbook.recalculate()
    const output = await SpreadsheetFile.exportXlsx(workbook)
    await output.save(temporaryPath)
    await fs.rename(temporaryPath, outputPath)
  } catch (error) {
    try {
      await fs.unlink(temporaryPath)
    } catch {
      // 临时文件不存在时无需处理。
    }
    throw error
  } finally {
    await fs.rm(`${temporaryPath}.inspect.ndjson`, { force: true })
  }
}

function toSqlString(value) {
  const text = asText(value)
  if (!text) return 'NULL'
  const escaped = text.replaceAll('\\', '\\\\').replaceAll("'", "''").replace(/\r?\n/g, '\\n')
  return `'${escaped}'`
}

function isNonEmptyRow(row) {
  return row.some((value) => asText(value) !== '')
}

function buildTiDbInsertSql(rows, indexes, batchSize, { allowLegacyIds = false } = {}) {
  const validRows = rows.filter(isNonEmptyRow)
  for (const row of validRows) {
    const id = asText(row[indexes.id])
    const idPattern = allowLegacyIds ? /^[1-9]\d*$/ : /^\d{8}$/
    if (!idPattern.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      throw new Error(`YC_ID 必须为正的 8 位数字，无法生成 SQL：${id || '空值'}`)
    }
    for (const [field, index] of [
      ['YC_NAME', indexes.name],
      ['YC_MODEL', indexes.model],
      ['YC_BRAND', indexes.brand],
    ]) {
      if (!asText(row[index])) throw new Error(`YC_ID ${id} 的 ${field} 为空，无法生成 SQL。`)
    }
  }
  const statements = []
  for (let start = 0; start < validRows.length; start += batchSize) {
    const batch = validRows.slice(start, start + batchSize)
    const values = batch.map((row) => {
      const id = Number(row[indexes.id])
      if (!Number.isInteger(id)) throw new Error(`YC_ID 不是整数，无法生成 SQL：${row[indexes.id]}`)
      return `(${id},${toSqlString(row[indexes.createdDate])},${toSqlString(row[indexes.name])},${toSqlString(row[indexes.model])},${toSqlString(row[indexes.brand])})`
    })
    statements.push(
      'insert into yc_DeviceModelIntoName (YC_ID,YC_CREATEDDATE,YC_NAME,YC_MODEL,YC_BRAND) values\n' +
        `${values.join(',\n')};`,
    )
  }
  return statements.length > 0 ? `${statements.join('\n\n')}\n` : '-- 本月份没有新增型号。\n'
}

async function saveTextFile(content, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  try {
    await fs.writeFile(temporaryPath, content, 'utf8')
    await fs.rename(temporaryPath, outputPath)
  } catch (error) {
    try {
      await fs.unlink(temporaryPath)
    } catch {
      // 临时文件不存在时无需处理。
    }
    throw error
  }
}

async function loadWorkbookTable(filePath, sheetName, label) {
  const input = await FileBlob.load(filePath)
  const workbook = await SpreadsheetFile.importXlsx(input)
  const sheet = getOnlyWorksheet(workbook, sheetName)
  const table = sheet.tables.items[0]
  if (!table) throw new Error(`${label}工作表“${sheetName}”中没有找到 Excel 表格。`)

  const header = table.getHeaderRowRange().values[0]
  const headerMap = makeHeaderMap(header, label)
  requireHeaders(headerMap, ['YC_ID', 'YC_CREATEDDATE', 'YC_BRAND', 'YC_MODEL', 'YC_NAME'], label)
  const indexes = {
    id: headerMap.get('yc_id'),
    createdDate: headerMap.get('yc_createddate'),
    brand: headerMap.get('yc_brand'),
    model: headerMap.get('yc_model'),
    name: headerMap.get('yc_name'),
  }

  return {
    workbook,
    sheet,
    table,
    header,
    indexes,
    rows: table.getDataRows().filter(isNonEmptyRow),
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findMonthlyPaths(initialPath, monthlyDirectory) {
  const stem = path.basename(initialPath, path.extname(initialPath))
  const pattern = new RegExp(`^${escapeRegExp(stem)}\\.(\\d{4}-(?:0[1-9]|1[0-2]))\\.xlsx$`, 'i')
  let entries
  try {
    entries = await fs.readdir(monthlyDirectory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => ({
      path: path.join(monthlyDirectory, entry.name),
      month: entry.name.match(pattern)[1],
    }))
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((entry) => entry.path)
}

function projectTargetRows(rows, sourceIndexes, targetIndexes, columnCount) {
  return rows.map((row) => {
    const projected = Array.from({ length: columnCount }, () => null)
    projected[targetIndexes.id] = row[sourceIndexes.id]
    projected[targetIndexes.createdDate] = row[sourceIndexes.createdDate]
    projected[targetIndexes.brand] = row[sourceIndexes.brand]
    projected[targetIndexes.model] = row[sourceIndexes.model]
    projected[targetIndexes.name] = row[sourceIndexes.name]
    return projected
  })
}

async function loadSource(csvText) {
  if (!csvText.trim()) throw new Error('源 CSV 为空。')
  const sourceWorkbook = await Workbook.fromCSV(csvText, { sheetName: 'models' })
  const sourceValues = sourceWorkbook.worksheets.getItemAt(0).getUsedRange().values
  const [sourceHeader = [], ...sourceRows] = sourceValues
  const sourceHeaderMap = makeHeaderMap(sourceHeader, '源 CSV')
  requireHeaders(
    sourceHeaderMap,
    ['model', 'dtype', 'brand', 'brand_title', 'code_alias', 'model_name'],
    '源 CSV',
  )
  if (sourceRows.length === 0) throw new Error('源 CSV 没有设备记录。')
  const dtypeIndex = sourceHeaderMap.get('dtype')
  if (!sourceRows.some((row) => ALLOWED_DTYPES.has(asText(row[dtypeIndex]).toLowerCase()))) {
    throw new Error(
      '源 CSV 未找到 dtype 为 mob 或 pad 的记录，请核对类型值（手机为 mob，不是 mod）。',
    )
  }
  return {
    sourceRows,
    sourceIndexes: {
      model: sourceHeaderMap.get('model'),
      dtype: sourceHeaderMap.get('dtype'),
      brand: sourceHeaderMap.get('brand'),
      brandTitle: sourceHeaderMap.get('brand_title'),
      codeAlias: sourceHeaderMap.get('code_alias'),
      modelName: sourceHeaderMap.get('model_name'),
    },
  }
}

async function fetchWithCurlFallback(url, options, fetchImpl, execFileImpl) {
  try {
    return await fetchImpl(url, options)
  } catch (error) {
    // Node 20/22 的 fetch 不自动读取代理环境变量，curl 可沿用系统的代理配置。
    console.warn(`直接下载失败（${error.cause?.code ?? error.message}），尝试使用 curl 下载。`)
    const headers = Object.entries(options.headers ?? {}).flatMap(([key, value]) => [
      '--header',
      `${key}: ${value}`,
    ])
    const { stdout } = await execFileImpl(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        ...headers,
        '--',
        url,
      ],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 65_000 },
    )
    return { ok: true, text: async () => stdout }
  }
}

async function fetchSource(url, options, { fetchImpl = fetch, execFileImpl = execFileAsync } = {}) {
  try {
    return await fetchWithCurlFallback(url, options, fetchImpl, execFileImpl)
  } catch (error) {
    if (url !== DEFAULT_SOURCE_URL) throw error
    console.warn(
      'GitHub Raw 下载失败，尝试 GitHub 官方 Contents API 获取同一仓库的 main/models.csv。',
    )
    return fetchWithCurlFallback(
      GITHUB_API_SOURCE_URL,
      {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: 'application/vnd.github.raw+json' },
      },
      fetchImpl,
      execFileImpl,
    )
  }
}

async function backupFile(filePath) {
  const backupDirectory = path.join(path.dirname(filePath), 'modelBak')
  await fs.mkdir(backupDirectory, { recursive: true })
  const timestamp = formatBackupTimestamp()
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(filePath)}.${timestamp}.${randomUUID()}.bak`,
  )
  await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL)
  return backupPath
}

function normalizeMonthlyNames(
  monthlyData,
  sourceRows,
  sourceIndexes,
  brandContext,
  initialRows,
  initialIndexes,
) {
  const sourceNames = new Map()
  const excludedModels = getExcludedSourceModels(sourceRows, sourceIndexes)
  for (const row of sourceRows) {
    if (!ALLOWED_DTYPES.has(asText(row[sourceIndexes.dtype]).toLowerCase())) continue
    const name = asText(row[sourceIndexes.modelName])
    if (!name.split('/')[0].trim() || hasExcludedNameKeyword(name)) continue
    const model = asText(
      row[isApple(row, sourceIndexes) ? sourceIndexes.codeAlias : sourceIndexes.model],
    )
    if (!model || excludedModels.has(model)) continue
    const key =
      normalizeBrandKey(row[sourceIndexes.brand]) ||
      normalizeBrandKey(row[sourceIndexes.brandTitle])
    const brand = brandContext.canonicalByKey.get(key)
    if (!brand) continue
    if (!selectDeviceName(name, brand, model, brandContext).name) continue
    const names = sourceNames.get(model) ?? []
    names.push({ name, brand })
    sourceNames.set(model, names)
  }
  let changedRows = 0
  const rows = monthlyData.rows.map((row) => {
    const name = asText(row[monthlyData.indexes.name])
    const brand = asText(row[monthlyData.indexes.brand])
    const names = sourceNames.get(asText(row[monthlyData.indexes.model])) ?? []
    const rawName = names.find((record) => record.brand === brand)?.name ?? names[0]?.name ?? name
    const normalized = normalizeModelName(
      rawName,
      brand,
      brandContext,
      initialRows,
      initialIndexes,
      asText(row[monthlyData.indexes.model]),
    ).name
    if (normalized === row[monthlyData.indexes.name]) return row
    if (!normalized)
      throw new Error(
        `名称未知或为空：${row[monthlyData.indexes.model]}，请使用 --revalidate-current-month 或 --revalidate-all 重新筛选。`,
      )
    changedRows += 1
    const updated = [...row]
    updated[monthlyData.indexes.name] = normalized
    return updated
  })
  return { rows, changedRows }
}

async function refreshSource(sourcePath, options, fetchImpl) {
  if (options.offline) return loadSource(await fs.readFile(sourcePath, 'utf8'))

  if (!options.dryRun && (await fileExists(sourcePath))) {
    const backupPath = await backupFile(sourcePath)
    console.log(`源文件备份：${backupPath}`)
  }

  console.log(`下载源文件：${options.sourceUrl}`)
  const response = await fetchImpl(options.sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`下载源 CSV 失败：HTTP ${response.status}`)
  const csvText = await response.text()
  const sourceData = await loadSource(csvText)
  if (!options.dryRun) await saveTextFile(csvText, sourcePath)
  return sourceData
}

async function revalidateAllFiles(options, initialPath, sourceRows, sourceIndexes) {
  const initialData = await loadWorkbookTable(initialPath, options.sheet, '初始目标 Excel')
  const files = [initialPath, ...(await findMonthlyPaths(initialPath, path.dirname(initialPath)))]
  const entries = []
  for (const filePath of files) {
    const data =
      filePath === initialPath
        ? initialData
        : await loadWorkbookTable(filePath, options.sheet, '月份 Excel')
    entries.push({ filePath, data })
  }
  const referenceRows = entries.flatMap(({ data }) =>
    projectTargetRows(data.rows, data.indexes, initialData.indexes, initialData.header.length),
  )
  const brandContext = buildBrandContext(
    sourceRows,
    sourceIndexes,
    referenceRows,
    initialData.indexes,
    options.nameOverrideEntries,
  )
  const sourceAudit = analyzeSourceModels(sourceRows, sourceIndexes, brandContext)
  printNameAudit(sourceAudit, options.dryRun)
  console.log(`源 dtype 分布：${JSON.stringify(sourceAudit.dtypeCounts)}`)
  console.log(
    `筛选后唯一型号：${sourceAudit.eligibleUniqueModels}，排除名称型号：${sourceAudit.excludedUniqueModels}，跨品牌同型号：${sourceAudit.ambiguousModels.length}（优先保留目标品牌及同品牌源名称）`,
  )
  const seenModels = new Map()
  const seenIds = new Map()
  const plans = []
  for (const { filePath, data } of entries) {
    const fileMonth =
      filePath === initialPath ? null : path.basename(filePath).match(/\.(\d{4}-\d{2})\.xlsx$/i)[1]
    const filtered = revalidateMonthlyRows(data, sourceRows, sourceIndexes, brandContext)
    const retained = []
    const brandChanges = {}
    let normalizedModels = 0
    for (const row of filtered.rows) {
      const model = asText(row[data.indexes.model])
      const id = asText(row[data.indexes.id])
      if (fileMonth && !new RegExp(`^${getMonthIdPrefix(fileMonth)}\\d{4}$`).test(id)) {
        throw new Error(`${path.basename(filePath)} 的 YC_ID ${id} 与月份不符，不会自动修改 ID。`)
      }
      if (seenModels.has(model)) {
        filtered.removedRows.push({
          id,
          model,
          brand: row[data.indexes.brand],
          name: row[data.indexes.name],
          reason: 'DUPLICATE_MODEL',
          keptIn: seenModels.get(model),
        })
        continue
      }
      if (seenIds.has(id))
        throw new Error(`跨文件 YC_ID 冲突：${id}，${seenIds.get(id)} 与 ${model}。请核对后重试。`)
      seenModels.set(model, path.basename(filePath))
      seenIds.set(id, model)
      const updated = [...row]
      if (row[data.indexes.model] !== model) normalizedModels += 1
      updated[data.indexes.model] = model
      const oldBrand = asText(row[data.indexes.brand])
      const brand = brandContext.canonicalByAlias.get(normalizeBrandKey(oldBrand)) ?? oldBrand
      updated[data.indexes.brand] = brand
      if (brand !== oldBrand) {
        const label = `${oldBrand} -> ${brand}`
        brandChanges[label] = (brandChanges[label] ?? 0) + 1
      }
      retained.push(updated)
    }
    const normalized = normalizeMonthlyNames(
      { ...data, rows: retained },
      sourceRows,
      sourceIndexes,
      brandContext,
      referenceRows,
      initialData.indexes,
    )
    const month =
      filePath === initialPath ? null : path.basename(filePath).match(/\.(\d{4}-\d{2})\.xlsx$/i)[1]
    const sqlPath = path.join(
      path.dirname(filePath),
      `${DEFAULT_SQL_STEM}${month ? `.${month}` : ''}.sql`,
    )
    const sql = buildTiDbInsertSql(normalized.rows, data.indexes, options.sqlBatchSize, {
      allowLegacyIds: month === null,
    })
    plans.push({
      filePath,
      sqlPath,
      data,
      rows: normalized.rows,
      sql,
      summary: {
        file: path.basename(filePath),
        beforeRows: data.rows.length,
        afterRows: normalized.rows.length,
        changedNames: normalized.changedRows,
        normalizedModels,
        brandChanges,
        removedRows: filtered.removedRows,
      },
    })
  }
  for (const plan of plans) console.log(JSON.stringify(plan.summary))
  if (options.dryRun) return

  const backupDirectory = path.join(path.dirname(initialPath), 'modelBak')
  await fs.mkdir(backupDirectory, { recursive: true })
  const stageDirectory = await fs.mkdtemp(path.join(backupDirectory, '.revalidate-all-'))
  try {
    // 全部校验、暂存成功后再覆盖原文件，避免导出失败时留下半份新结果。
    for (const plan of plans) {
      plan.data.table = replaceTableRows(
        plan.data.sheet,
        plan.data.table,
        plan.data.header,
        plan.rows,
      )
      await saveWorkbook(
        plan.data.workbook,
        path.join(stageDirectory, path.basename(plan.filePath)),
      )
      await saveTextFile(plan.sql, path.join(stageDirectory, path.basename(plan.sqlPath)))
    }
    const backups = []
    for (const plan of plans) {
      backups.push(await backupFile(plan.filePath))
      if (await fileExists(plan.sqlPath)) backups.push(await backupFile(plan.sqlPath))
    }
    const reportPath = path.join(
      backupDirectory,
      `revalidate-all.${formatBackupTimestamp()}.${randomUUID()}.json`,
    )
    await saveTextFile(
      JSON.stringify(
        {
          sourcePath: resolvePath(options.source),
          sourceAudit,
          backups,
          files: plans.map((plan) => plan.summary),
        },
        null,
        2,
      ),
      reportPath,
    )
    for (const plan of plans) {
      await fs.rename(path.join(stageDirectory, path.basename(plan.filePath)), plan.filePath)
      await fs.rename(path.join(stageDirectory, path.basename(plan.sqlPath)), plan.sqlPath)
    }
    console.log(`全部文件更新完成，报告：${reportPath}`)
  } finally {
    await fs.rm(stageDirectory, { recursive: true, force: true })
  }
}

async function initializeFiles(options, initialPath, sourceRows, sourceIndexes, month) {
  const directory = path.dirname(initialPath)
  const initialData = await loadWorkbookTable(initialPath, options.sheet, '初始化模板')
  const monthlyPaths = await findMonthlyPaths(initialPath, directory)
  const previous = [{ filePath: initialPath, data: initialData }]
  for (const filePath of monthlyPaths) {
    previous.push({
      filePath,
      data: await loadWorkbookTable(filePath, options.sheet, '月份 Excel'),
    })
  }
  const referenceRows = previous.flatMap(({ data }) =>
    projectTargetRows(data.rows, data.indexes, initialData.indexes, initialData.header.length),
  )
  const context = buildBrandContext(
    sourceRows,
    sourceIndexes,
    referenceRows,
    initialData.indexes,
    options.nameOverrideEntries,
  )
  const { newRecords, stats } = buildNewRecords(
    sourceRows,
    sourceIndexes,
    [],
    initialData.indexes,
    context,
  )
  if (!newRecords.length) throw new Error('初始化结果为空，停止以避免清除现有数据。')
  const year = month.slice(0, 4)
  const prefix = `${year.slice(-2)}00`
  const rows = toTargetRows(newRecords, initialData.indexes, prefix, 1, initialData.header.length)
  const sql = buildTiDbInsertSql(rows, initialData.indexes, options.sqlBatchSize)
  const sourceAudit = analyzeSourceModels(sourceRows, sourceIndexes, context)
  const sqlPath = path.join(directory, `${DEFAULT_SQL_STEM}.sql`)
  const reportPath = path.join(directory, `初始化报告.${year}.json`)
  const entries = await fs.readdir(directory)
  const processedPaths = [
    ...new Set([
      initialPath,
      ...monthlyPaths,
      ...entries
        .filter(
          (name) =>
            /^yc_DeviceModelIntoName(?:\.\d{4}-\d{2})?\.sql$/i.test(name) ||
            /^校验报告\..+\.md$/.test(name) ||
            /^初始化报告\.\d{4}\.json$/.test(name),
        )
        .map((name) => path.join(directory, name)),
    ]),
  ]
  const newIds = new Map(
    rows.map((row) => [row[initialData.indexes.model], row[initialData.indexes.id]]),
  )
  const idMapping = previous.flatMap(({ filePath, data }) =>
    data.rows.map((row) => ({
      file: path.basename(filePath),
      model: asText(row[data.indexes.model]),
      oldId: row[data.indexes.id],
      newId: newIds.get(asText(row[data.indexes.model])) ?? null,
    })),
  )
  console.log(
    `初始化：${rows.length} 条，ID ${prefix}0001 至 ${rows.at(-1)[initialData.indexes.id]}`,
  )
  console.log(`将备份并归档 ${processedPaths.length} 个处理结果文件，仅保留一份初始 Excel 和 SQL。`)
  printNameAudit(sourceAudit, options.dryRun)
  if (options.dryRun) return

  const backupDirectory = path.join(
    directory,
    'modelBak',
    `initialize.${formatBackupTimestamp()}.${randomUUID()}`,
  )
  const stageDirectory = path.join(backupDirectory, 'staged')
  await fs.mkdir(stageDirectory, { recursive: true })
  let publishing = false
  const backups = []
  try {
    initialData.table = replaceTableRows(
      initialData.sheet,
      initialData.table,
      initialData.header,
      rows,
    )
    await saveWorkbook(initialData.workbook, path.join(stageDirectory, path.basename(initialPath)))
    await saveTextFile(sql, path.join(stageDirectory, path.basename(sqlPath)))
    await fs.mkdir(path.join(backupDirectory, 'files'))
    for (const filePath of processedPaths) {
      const backupPath = path.join(backupDirectory, 'files', path.basename(filePath))
      await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL)
      backups.push({ filePath, backupPath })
    }
    await fs.copyFile(resolvePath(options.source), path.join(backupDirectory, 'source-models.csv'))
    await fs.copyFile(
      resolvePath(options.nameOverrides),
      path.join(backupDirectory, 'nameOverrides.json'),
    )
    const report = {
      timestamp: formatBackupTimestamp(),
      year,
      prefix,
      count: rows.length,
      firstId: rows[0][initialData.indexes.id],
      lastId: rows.at(-1)[initialData.indexes.id],
      initialPath,
      sqlPath,
      backups,
      stats,
      sourceAudit,
      idMapping,
    }
    await saveTextFile(JSON.stringify(report, null, 2), path.join(backupDirectory, 'manifest.json'))
    await saveTextFile(
      JSON.stringify(report, null, 2),
      path.join(stageDirectory, path.basename(reportPath)),
    )
    publishing = true
    await fs.rename(path.join(stageDirectory, path.basename(initialPath)), initialPath)
    await fs.rename(path.join(stageDirectory, path.basename(sqlPath)), sqlPath)
    await fs.rename(path.join(stageDirectory, path.basename(reportPath)), reportPath)
    for (const filePath of processedPaths) {
      if (![initialPath, sqlPath, reportPath].includes(filePath)) await fs.unlink(filePath)
    }
    console.log(
      `初始化完成：${initialPath}\nSQL：${sqlPath}\n备份：${backupDirectory}\n报告：${reportPath}`,
    )
  } catch (error) {
    if (publishing) {
      for (const { filePath, backupPath } of backups) await fs.copyFile(backupPath, filePath)
      for (const filePath of [sqlPath, reportPath]) {
        if (!processedPaths.includes(filePath)) await fs.rm(filePath, { force: true })
      }
    }
    throw error
  } finally {
    await fs.rm(stageDirectory, { recursive: true, force: true })
  }
}

export async function run(argv = process.argv.slice(2), { fetchImpl = fetchSource } = {}) {
  const options = parseArgs(argv)
  options.nameOverrideEntries = JSON.parse(
    await fs.readFile(resolvePath(options.nameOverrides), 'utf8'),
  )
  const sourcePath = resolvePath(options.source)
  const initialPath = resolvePath(options.target ?? DEFAULT_TARGET)
  const month = validateMonth(options.month ?? localMonthString())
  const monthlyPath = options.output
    ? resolvePath(options.output)
    : path.join(path.dirname(initialPath), `${DEFAULT_OUTPUT_STEM}.${month}.xlsx`)
  const sqlPath = options.sqlOutput
    ? resolvePath(options.sqlOutput)
    : path.join(path.dirname(monthlyPath), `${DEFAULT_SQL_STEM}.${month}.sql`)
  const monthlyDirectory = path.dirname(monthlyPath)

  if (initialPath === monthlyPath) {
    throw new Error('初始目标文件不能与月份增量文件相同，请通过 --output 指定其他路径。')
  }
  if (initialPath === sqlPath || monthlyPath === sqlPath) {
    throw new Error(
      'SQL 文件不能覆盖初始目标文件或月份增量文件，请通过 --sql-output 指定其他路径。',
    )
  }
  if ([initialPath, monthlyPath, sqlPath].includes(sourcePath)) {
    throw new Error('源 CSV 路径不能与 Excel 或 SQL 文件相同。')
  }
  if (options.revalidateAll && (options.output || options.sqlOutput)) {
    throw new Error('--revalidate-all 根据各 Excel 名称生成 SQL，不支持 --output 或 --sql-output。')
  }
  if (
    options.initialize &&
    (options.revalidateAll ||
      options.revalidateCurrentMonth ||
      options.normalizeCurrentMonth ||
      options.output ||
      options.sqlOutput)
  ) {
    throw new Error('--initialize 不能与其他清洗模式、--output 或 --sql-output 同时使用。')
  }

  const { sourceRows, sourceIndexes } = await refreshSource(sourcePath, options, fetchImpl)
  if (options.initialize)
    return initializeFiles(options, initialPath, sourceRows, sourceIndexes, month)
  if (options.revalidateAll)
    return revalidateAllFiles(options, initialPath, sourceRows, sourceIndexes)
  const initialData = await loadWorkbookTable(initialPath, options.sheet, '初始目标 Excel')
  const initialRows = initialData.rows
  const initialIndexes = initialData.indexes
  const duplicateInitialModels = findDuplicateValues(initialRows, initialIndexes.model)
  if (duplicateInitialModels.length > 0) {
    console.warn(
      `警告：初始文件有 ${duplicateInitialModels.length} 个重复型号，读取时按一个型号处理。`,
    )
  }

  let monthlyPaths = [
    ...new Set([
      ...(await findMonthlyPaths(initialPath, path.dirname(initialPath))),
      ...(await findMonthlyPaths(initialPath, monthlyDirectory)),
    ]),
  ].filter((filePath) => filePath !== initialPath)
  if ((await fileExists(monthlyPath)) && !monthlyPaths.includes(monthlyPath)) {
    monthlyPaths = [...monthlyPaths, monthlyPath]
  }

  const historicalRows = []
  for (const historicalPath of monthlyPaths) {
    const historicalData = await loadWorkbookTable(historicalPath, options.sheet, '历史月份 Excel')
    const duplicateHistoricalModels = findDuplicateValues(
      historicalData.rows,
      historicalData.indexes.model,
    )
    if (duplicateHistoricalModels.length > 0) {
      console.warn(
        `警告：历史月份文件 ${historicalPath} 内有 ${duplicateHistoricalModels.length} 个重复型号，读取时按一个型号处理。`,
      )
    }
    historicalRows.push(
      ...projectTargetRows(
        historicalData.rows,
        historicalData.indexes,
        initialIndexes,
        initialData.header.length,
      ),
    )
  }

  const knownRows = [...initialRows, ...historicalRows]
  const knownModels = new Set(
    knownRows.map((row) => asText(row[initialIndexes.model])).filter(Boolean),
  )
  const duplicateKnownModels = findDuplicateValues(knownRows, initialIndexes.model)
  const brandContext = buildBrandContext(
    sourceRows,
    sourceIndexes,
    knownRows,
    initialIndexes,
    options.nameOverrideEntries,
  )
  const sourceAudit = analyzeSourceModels(sourceRows, sourceIndexes, brandContext)
  printNameAudit(sourceAudit, options.dryRun)
  const { newRecords, stats } = buildNewRecords(
    sourceRows,
    sourceIndexes,
    knownRows,
    initialIndexes,
    brandContext,
  )

  let monthlyData
  if (await fileExists(monthlyPath)) {
    monthlyData = await loadWorkbookTable(monthlyPath, options.sheet, '月份 Excel')
    const duplicateCurrentModels = findDuplicateValues(monthlyData.rows, monthlyData.indexes.model)
    if (duplicateCurrentModels.length > 0) {
      throw new Error(
        `当前月份文件的 YC_MODEL 已存在重复值（示例：${duplicateCurrentModels.slice(0, 5).join(', ')}），请先清理后再执行。`,
      )
    }
  } else {
    monthlyData = await loadWorkbookTable(initialPath, options.sheet, '月份模板')
    monthlyData.table = replaceTableRows(
      monthlyData.sheet,
      monthlyData.table,
      monthlyData.header,
      [],
    )
    monthlyData.rows = []
  }

  const nextSequence = getNextMonthSequence(knownRows, initialIndexes.id, month)
  const newRows = toMonthTargetRows(
    newRecords,
    monthlyData.indexes,
    month,
    nextSequence,
    monthlyData.header.length,
  )
  const currentMonthlyModels = new Set(
    monthlyData.rows.map((row) => asText(row[monthlyData.indexes.model])).filter(Boolean),
  )
  const newMonthlyRows = newRows.filter(
    (row) => !currentMonthlyModels.has(asText(row[monthlyData.indexes.model])),
  )
  const revalidatedMonthly = options.revalidateCurrentMonth
    ? revalidateMonthlyRows(monthlyData, sourceRows, sourceIndexes, brandContext)
    : { rows: monthlyData.rows, removedRows: [] }
  const normalizedMonthly =
    options.normalizeCurrentMonth || options.revalidateCurrentMonth
      ? normalizeMonthlyNames(
          { ...monthlyData, rows: revalidatedMonthly.rows },
          sourceRows,
          sourceIndexes,
          brandContext,
          initialRows,
          initialIndexes,
        )
      : { rows: revalidatedMonthly.rows, changedRows: 0 }

  console.log(`源文件：${sourcePath}`)
  console.log(`固定初始文件：${initialPath}`)
  console.log(`读取月份文件：${monthlyPaths.length} 个`)
  console.log(`月份增量文件：${monthlyPath}${monthlyData.rows.length === 0 ? '（新建）' : ''}`)
  console.log(`TiDB SQL 文件：${sqlPath}，批量大小 ${options.sqlBatchSize}`)
  console.log(
    `已知型号：${knownModels.size} 条${duplicateKnownModels.length > 0 ? `，历史重复 ${duplicateKnownModels.length} 条` : ''}`,
  )
  console.log(`源记录：${stats.sourceRows}，手机/PAD：${stats.allowedRows}`)
  console.log(`源 dtype 分布：${JSON.stringify(sourceAudit.dtypeCounts)}`)
  console.log(`源中跨品牌同型号：${sourceAudit.ambiguousModels.length}（详见全量校验报告）`)
  console.log(
    `跳过：其他类型 ${stats.skippedOtherDtype}，名称关键词 ${stats.skippedExcludedName}，源内重复 ${stats.skippedSourceDuplicate}，` +
      `目标已有 ${stats.skippedExistingTarget}，Apple 缺少 code_alias ${stats.skippedAppleMissingCodeAlias}，未知名称 ${stats.skippedUnknownName}`,
  )
  console.log(
    `名称补品牌：${stats.prefixedBrandNames} 条，特殊品牌名称规范化：${stats.normalizedSpecialBrandNames} 条`,
  )
  console.log(`本次新增型号：${newMonthlyRows.length}`)
  console.log(`当前月份已有名称更新：${normalizedMonthly.changedRows} 条`)
  console.log(`当前月份移出不合规记录：${revalidatedMonthly.removedRows.length} 条`)
  if (revalidatedMonthly.removedRows.length > 0) {
    console.log(
      `移出原因分布：${JSON.stringify(Object.fromEntries(countValues(revalidatedMonthly.removedRows.map((row) => row.reason))))}`,
    )
  }
  console.log(`月份文件写入后：${normalizedMonthly.rows.length + newMonthlyRows.length} 条`)

  if (options.dryRun) return

  if (
    newMonthlyRows.length === 0 &&
    monthlyData.rows.length === 0 &&
    !(await fileExists(monthlyPath))
  ) {
    console.log('没有新增型号，不创建空的月份 Excel 或 SQL。')
    return
  }

  if (normalizedMonthly.changedRows > 0 || revalidatedMonthly.removedRows.length > 0) {
    const backupPath = await backupFile(monthlyPath)
    console.log(`月份文件备份：${backupPath}`)
    if (revalidatedMonthly.removedRows.length > 0) {
      const reportPath = `${backupPath}.filtered-rows.json`
      await saveTextFile(
        JSON.stringify({ month, sourcePath, removedRows: revalidatedMonthly.removedRows }, null, 2),
        reportPath,
      )
      console.log(`移出明细：${reportPath}`)
    }
    if (await fileExists(sqlPath)) console.log(`月份 SQL 备份：${await backupFile(sqlPath)}`)
    monthlyData.table = replaceTableRows(
      monthlyData.sheet,
      monthlyData.table,
      monthlyData.header,
      normalizedMonthly.rows,
    )
  }
  if (newMonthlyRows.length > 0) monthlyData.table.appendRows(newMonthlyRows)
  const finalMonthlyRows = monthlyData.table.getDataRows().filter(isNonEmptyRow)
  const finalMonthlyDuplicateModels = findDuplicateValues(
    finalMonthlyRows,
    monthlyData.indexes.model,
  )
  if (finalMonthlyDuplicateModels.length > 0) {
    throw new Error(
      `写入月份文件后 YC_MODEL 出现重复值：${finalMonthlyDuplicateModels.slice(0, 5).join(', ')}`,
    )
  }

  const sql = buildTiDbInsertSql(finalMonthlyRows, monthlyData.indexes, options.sqlBatchSize)
  if (
    newMonthlyRows.length > 0 ||
    normalizedMonthly.changedRows > 0 ||
    revalidatedMonthly.removedRows.length > 0 ||
    !(await fileExists(monthlyPath))
  ) {
    await saveWorkbook(monthlyData.workbook, monthlyPath)
  }
  await saveTextFile(sql, sqlPath)
  console.log(`写入完成：${finalMonthlyRows.length} 条，本次新增 ${newMonthlyRows.length} 条。`)
  console.log(`SQL 写入完成：${Math.ceil(finalMonthlyRows.length / options.sqlBatchSize)} 个批次。`)
}

export {
  analyzeSourceModels,
  buildBrandContext,
  buildNewRecords,
  buildTiDbInsertSql,
  fetchSource,
  formatBackupTimestamp,
  getNextMonthSequence,
  loadSource,
  localMonthString,
  normalizeModelName,
  revalidateMonthlyRows,
  toMonthTargetRows,
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error)
    process.exitCode = 1
  })
}
