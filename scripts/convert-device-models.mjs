#!/usr/bin/env node
// node scripts/convert-device-models.mjs --month 2026-07

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const DEVICE_MODEL_DIR = path.join(REPO_ROOT, 'scripts/deviceModel')
const DEFAULT_SOURCE = path.join(DEVICE_MODEL_DIR, 'models.csv')
const DEFAULT_TARGET = path.join(DEVICE_MODEL_DIR, '设备型号转译.xlsx')
const DEFAULT_OUTPUT_STEM = '设备型号转译'
const DEFAULT_SQL_STEM = 'yc_DeviceModelIntoName'
const DEFAULT_SQL_BATCH_SIZE = 200
const DEFAULT_SHEET = '设备型号转译'
const ALLOWED_DTYPES = new Set(['mob', 'pad'])
const EXCLUDED_NAME_KEYWORDS = ['电脑', '笔记本', '游戏本', 'magicbook', 'matebook', '翻译机', '座舱', '汽车', '四足机器人']
const BRAND_NAME_OVERRIDES = new Map([
  ['huawei', '华为'],
  ['honor', '荣耀'],
  ['sony', '索尼'],
  ['samsung', '三星'],
])
const GENERIC_NAME_TOKENS = new Set(['手机', '智能手机', '游戏手机', '平板', 'pad', 'phone', 'mobile', 'smartphone', 'tablet'])

function printHelp() {
  console.log(`用法:
  node scripts/convert-device-models.mjs [选项]

默认行为:
  - 读取 scripts/deviceModel/models.csv
  - 设备型号转译.xlsx 作为固定初始文件，不会被脚本修改
  - 读取初始文件和目录下全部设备型号转译.YYYY-MM.xlsx作为已知型号
  - 只保留 dtype 为 mob 或 pad 的记录；名称含电脑、笔记本、游戏本、MagicBook、MateBook、翻译机、座舱、汽车、四足机器人的记录过滤掉
  - Apple 使用 code_alias 作为 YC_MODEL，其他品牌使用 model 作为 YC_MODEL
  - YC_MODEL 全局去重，并排除初始文件和历史月份文件中已经存在的型号
  - 品牌显示名沿用目标文件中的中文/英文规范
  - 明确统一 HUAWEI→华为、HONOR→荣耀、Sony→索尼、Samsung→三星
  - 手机名称无法辨识品牌时，在名称前添加品牌名
  - 手机和 pad 的名称规则都适用：realme 名称中的“真我”替换为“realme”，缺少 realme 时补“realme ”前缀
  - 手机和 pad 的努比亚名称缺少“努比亚”或“红魔”时补“努比亚 ”前缀
  - 手机和 pad 的 360 名称缺少“360”时补“360 ”前缀
  - 手机和 pad 的 vivo 名称缺少“vivo”或“IQOO”时补“vivo ”前缀
  - 手机和 pad 的 Sony 名称缺少“索尼”或“Sony”时补“sony ”前缀
  - 月份文件只保存本次新增型号；同月重复执行会继续追加到同一个月份文件
  - 同时生成 TiDB 插入 SQL：scripts/deviceModel/yc_DeviceModelIntoName.YYYY-MM.sql
  - SQL 默认每 ${DEFAULT_SQL_BATCH_SIZE} 条组成一个批量 INSERT，不修改初始文件

选项:
  --source <path>   指定源 CSV
  --target <path>   指定固定初始目标 Excel
  --output <path>   指定月份增量文件；默认按月份命名
  --sql-output <path> 指定 TiDB SQL 文件；默认按月份命名
  --sql-batch-size <n> SQL 每批插入条数；默认 ${DEFAULT_SQL_BATCH_SIZE}
  --month <month>   指定输出月份，格式 YYYY-MM
  --sheet <name>    指定目标工作表；默认“设备型号转译”
  --dry-run         只统计，不写出 Excel
  --help            显示帮助
`)
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
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

    const option = {
      '--source': 'source',
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

function localMonthString(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function validateMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`月份格式必须是 YYYY-MM，当前值：${value}`)
  }
  return value
}

function isApple(row, indexes) {
  return [row[indexes.brand], row[indexes.brandTitle]].some((value) => asText(value).toLowerCase() === 'apple')
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

function buildBrandContext(sourceRows, sourceIndexes, targetRows, targetIndexes) {
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
  for (const [key, group] of groups) {
    const matches = targetBrands.filter((targetBrand) => group.aliases.has(normalizeBrandKey(targetBrand))).sort((left, right) => (targetBrandCounts.get(right) ?? 0) - (targetBrandCounts.get(left) ?? 0))
    const explicitCanonical = [...group.aliases].map((alias) => BRAND_NAME_OVERRIDES.get(alias)).find(Boolean)
    const canonical = explicitCanonical ?? matches[0] ?? chooseMostFrequent(group.titles, key)
    canonicalByKey.set(key, canonical)
    const canonicalKey = normalizeBrandKey(canonical)
    const aliases = aliasesByBrand.get(canonicalKey) ?? new Set()
    for (const alias of group.aliases) aliases.add(alias)
    aliases.add(canonicalKey)
    aliasesByBrand.set(canonicalKey, aliases)
  }

  const knownNameTokensByBrand = new Map()
  for (const row of targetRows) {
    const brand = asText(row[targetIndexes.brand])
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

  return { aliasesByBrand, canonicalByKey, knownNameTokensByBrand }
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
    const separator = [...separatorCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
    return separator === '<none>' ? '' : (separator ?? ' ')
  }
  return /^(手机|智能手机|phone|smartphone|mobile)/i.test(asText(name)) ? '' : ' '
}

function normalizeModelName(name, brand, brandContext, targetRows, targetIndexes) {
  if (!name) return { name, prefixed: false }
  const key = normalizeBrandKey(brand)
  if (key === '索尼' || key === 'sony') {
    if (/(索尼|sony)/i.test(name)) return { name, prefixed: false }
    return { name: `sony ${name}`, prefixed: true }
  }
  if (key === 'realme' || key === '真我') {
    const normalizedName = name.replace(/真我/g, 'realme')
    if (normalizeBrandKey(normalizedName).includes('realme')) {
      return { name: normalizedName, prefixed: false, normalizedBrandName: normalizedName !== name }
    }
    return { name: `${brand} ${normalizedName}`, prefixed: true, normalizedBrandName: normalizedName !== name }
  }
  if (key === '努比亚' || key === 'nubia') {
    if (/(努比亚|nubia|红魔|redmagic)/i.test(name)) return { name, prefixed: false }
    return { name: `${brand} ${name}`, prefixed: true }
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

function buildNewRecords(sourceRows, sourceIndexes, targetRows, targetIndexes, brandContext) {
  const targetModels = new Set(targetRows.map((row) => asText(row[targetIndexes.model])).filter(Boolean))
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

    const brandKey = normalizeBrandKey(row[sourceIndexes.brand]) || normalizeBrandKey(row[sourceIndexes.brandTitle])
    const brand = brandContext.canonicalByKey.get(brandKey) || asText(row[sourceIndexes.brandTitle]) || asText(row[sourceIndexes.brand])
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
    if (hasExcludedNameKeyword(rawName)) {
      stats.skippedExcludedName += 1
      continue
    }
    const normalizedName = normalizeModelName(rawName, brand, brandContext, targetRows, targetIndexes)
    const name = normalizedName.name
    if (!name) {
      stats.skippedMissingName += 1
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
  return records.map((record, offset) => {
    const sequence = startSequence + offset
    if (sequence > 9999) {
      throw new Error(`月份 ${month} 的 YC_ID 序号已超过 9999，无法继续生成 8 位 ID。`)
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
  }
}

function toSqlString(value) {
  const text = asText(value)
  if (!text) return 'NULL'
  const escaped = text.replaceAll('\\', '\\\\').replaceAll("'", "''").replace(/\r?\n/g, '\\n')
  return `'${escaped}'`
}

function buildTiDbInsertSql(rows, indexes, batchSize) {
  const statements = []
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const values = batch.map((row) => {
      const id = Number(row[indexes.id])
      if (!Number.isInteger(id)) throw new Error(`YC_ID 不是整数，无法生成 SQL：${row[indexes.id]}`)
      return `(${id},${toSqlString(row[indexes.createdDate])},${toSqlString(row[indexes.name])},${toSqlString(row[indexes.model])},${toSqlString(row[indexes.brand])})`
    })
    statements.push('insert into yc_DeviceModelIntoName (YC_ID,YC_CREATEDDATE,YC_NAME,YC_MODEL,YC_BRAND) values\n' + `${values.join(',\n')};`)
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

  return { workbook, sheet, table, header, indexes, rows: table.getDataRows() }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findMonthlyPaths(initialPath, monthlyDirectory) {
  const stem = path.basename(initialPath, path.extname(initialPath))
  const pattern = new RegExp(`^${escapeRegExp(stem)}\\.(\\d{4}-(?:0[1-9]|1[0-2]))\\.xlsx$`, 'i')
  const entries = await fs.readdir(monthlyDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => ({ path: path.join(monthlyDirectory, entry.name), month: entry.name.match(pattern)[1] }))
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourcePath = resolvePath(options.source)
  const initialPath = resolvePath(options.target ?? DEFAULT_TARGET)
  const month = validateMonth(options.month ?? localMonthString())
  const monthlyPath = options.output ? resolvePath(options.output) : path.join(path.dirname(initialPath), `${DEFAULT_OUTPUT_STEM}.${month}.xlsx`)
  const sqlPath = options.sqlOutput ? resolvePath(options.sqlOutput) : path.join(path.dirname(monthlyPath), `${DEFAULT_SQL_STEM}.${month}.sql`)
  const monthlyDirectory = path.dirname(monthlyPath)

  if (initialPath === monthlyPath) {
    throw new Error('初始目标文件不能与月份增量文件相同，请通过 --output 指定其他路径。')
  }
  if (initialPath === sqlPath || monthlyPath === sqlPath) {
    throw new Error('SQL 文件不能覆盖初始目标文件或月份增量文件，请通过 --sql-output 指定其他路径。')
  }

  const csvText = await fs.readFile(sourcePath, 'utf8')
  const sourceWorkbook = await Workbook.fromCSV(csvText, { sheetName: 'models' })
  const sourceSheet = sourceWorkbook.worksheets.getItemAt(0)
  const sourceValues = sourceSheet.getUsedRange().values
  const [sourceHeader, ...sourceRows] = sourceValues
  const sourceHeaderMap = makeHeaderMap(sourceHeader, '源 CSV')
  requireHeaders(sourceHeaderMap, ['model', 'dtype', 'brand', 'brand_title', 'code_alias', 'model_name'], '源 CSV')
  const sourceIndexes = {
    model: sourceHeaderMap.get('model'),
    dtype: sourceHeaderMap.get('dtype'),
    brand: sourceHeaderMap.get('brand'),
    brandTitle: sourceHeaderMap.get('brand_title'),
    codeAlias: sourceHeaderMap.get('code_alias'),
    modelName: sourceHeaderMap.get('model_name'),
  }
  const initialData = await loadWorkbookTable(initialPath, options.sheet, '初始目标 Excel')
  const initialRows = initialData.rows
  const initialIndexes = initialData.indexes
  const duplicateInitialModels = findDuplicateValues(initialRows, initialIndexes.model)
  if (duplicateInitialModels.length > 0) {
    throw new Error(`初始目标文件的 YC_MODEL 已存在重复值（示例：${duplicateInitialModels.slice(0, 5).join(', ')}），请先清理后再执行。`)
  }

  let monthlyPaths = await findMonthlyPaths(initialPath, monthlyDirectory)
  if ((await fileExists(monthlyPath)) && !monthlyPaths.includes(monthlyPath)) {
    monthlyPaths = [...monthlyPaths, monthlyPath]
  }

  const historicalRows = []
  for (const historicalPath of monthlyPaths) {
    const historicalData = await loadWorkbookTable(historicalPath, options.sheet, '历史月份 Excel')
    const duplicateHistoricalModels = findDuplicateValues(historicalData.rows, historicalData.indexes.model)
    if (duplicateHistoricalModels.length > 0) {
      console.warn(`警告：历史月份文件 ${historicalPath} 内有 ${duplicateHistoricalModels.length} 个重复型号，读取时按一个型号处理。`)
    }
    historicalRows.push(...projectTargetRows(historicalData.rows, historicalData.indexes, initialIndexes, initialData.header.length))
  }

  const knownRows = [...initialRows, ...historicalRows]
  const knownModels = new Set(knownRows.map((row) => asText(row[initialIndexes.model])).filter(Boolean))
  const duplicateKnownModels = findDuplicateValues(knownRows, initialIndexes.model)
  const brandContext = buildBrandContext(sourceRows, sourceIndexes, knownRows, initialIndexes)
  const { newRecords, stats } = buildNewRecords(sourceRows, sourceIndexes, knownRows, initialIndexes, brandContext)

  let monthlyData
  if (await fileExists(monthlyPath)) {
    monthlyData = await loadWorkbookTable(monthlyPath, options.sheet, '月份 Excel')
    const duplicateCurrentModels = findDuplicateValues(monthlyData.rows, monthlyData.indexes.model)
    if (duplicateCurrentModels.length > 0) {
      throw new Error(`当前月份文件的 YC_MODEL 已存在重复值（示例：${duplicateCurrentModels.slice(0, 5).join(', ')}），请先清理后再执行。`)
    }
  } else {
    monthlyData = await loadWorkbookTable(initialPath, options.sheet, '月份模板')
    monthlyData.table = replaceTableRows(monthlyData.sheet, monthlyData.table, monthlyData.header, [])
    monthlyData.rows = []
  }

  const nextSequence = getNextMonthSequence(knownRows, initialIndexes.id, month)
  const newRows = toMonthTargetRows(newRecords, monthlyData.indexes, month, nextSequence, monthlyData.header.length)
  const currentMonthlyModels = new Set(monthlyData.rows.map((row) => asText(row[monthlyData.indexes.model])).filter(Boolean))
  const newMonthlyRows = newRows.filter((row) => !currentMonthlyModels.has(asText(row[monthlyData.indexes.model])))

  console.log(`源文件：${sourcePath}`)
  console.log(`固定初始文件：${initialPath}`)
  console.log(`读取月份文件：${monthlyPaths.length} 个`)
  console.log(`月份增量文件：${monthlyPath}${monthlyData.rows.length === 0 ? '（新建）' : ''}`)
  console.log(`TiDB SQL 文件：${sqlPath}，批量大小 ${options.sqlBatchSize}`)
  console.log(`已知型号：${knownModels.size} 条${duplicateKnownModels.length > 0 ? `，历史重复 ${duplicateKnownModels.length} 条` : ''}`)
  console.log(`源记录：${stats.sourceRows}，手机/PAD：${stats.allowedRows}`)
  console.log(`跳过：其他类型 ${stats.skippedOtherDtype}，名称关键词 ${stats.skippedExcludedName}，源内重复 ${stats.skippedSourceDuplicate}，` + `目标已有 ${stats.skippedExistingTarget}，Apple 缺少 code_alias ${stats.skippedAppleMissingCodeAlias}`)
  console.log(`名称补品牌：${stats.prefixedBrandNames} 条，特殊品牌名称规范化：${stats.normalizedSpecialBrandNames} 条`)
  console.log(`本次新增型号：${newMonthlyRows.length}`)
  console.log(`月份文件写入后：${monthlyData.rows.length + newMonthlyRows.length} 条`)

  if (options.dryRun) return

  if (newMonthlyRows.length > 0) monthlyData.table.appendRows(newMonthlyRows)
  const finalMonthlyRows = monthlyData.table.getDataRows()
  const finalMonthlyDuplicateModels = findDuplicateValues(finalMonthlyRows, monthlyData.indexes.model)
  if (finalMonthlyDuplicateModels.length > 0) {
    throw new Error(`写入月份文件后 YC_MODEL 出现重复值：${finalMonthlyDuplicateModels.slice(0, 5).join(', ')}`)
  }

  await saveWorkbook(monthlyData.workbook, monthlyPath)
  const sql = buildTiDbInsertSql(finalMonthlyRows, monthlyData.indexes, options.sqlBatchSize)
  await saveTextFile(sql, sqlPath)
  console.log(`写入完成：${finalMonthlyRows.length} 条，本次新增 ${newMonthlyRows.length} 条。`)
  console.log(`SQL 写入完成：${Math.ceil(finalMonthlyRows.length / options.sqlBatchSize)} 个批次。`)
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
