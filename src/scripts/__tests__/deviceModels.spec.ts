// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Codex 提供的运行时包没有发布 TypeScript 声明。
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'
// @ts-expect-error 被测 CLI 是原生 JavaScript 模块。
import * as converter from '../../../scripts/deviceModel/convert-device-models.mjs'

const {
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
  run,
  toMonthTargetRows,
} = converter

const header = ['YC_ID', 'YC_CREATEDDATE', 'YC_BRAND', 'YC_MODEL', 'YC_NAME']
const indexes = { id: 0, createdDate: 1, brand: 2, model: 3, name: 4 }
const csvHeader = 'model,dtype,brand,brand_title,code_alias,model_name\n'
const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  )
})

describe('设备型号转换', () => {
  it('初始化先备份全部历史数据，再生成唯一初始文件和 2600 ID，增量无新增时不生成空文件', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'device-models-init-'))
    directories.push(dir)
    const sourcePath = path.join(dir, 'models.csv')
    const initialPath = path.join(dir, '设备型号转译.xlsx')
    const monthlyPath = path.join(dir, '设备型号转译.2026-07.xlsx')
    const oldSql = path.join(dir, 'yc_DeviceModelIntoName.2026-07.sql')
    const oldReport = path.join(dir, '校验报告.2026-10.md')
    const csv =
      csvHeader +
      [
        'phone,mob,huawei,HUAWEI,,HUAWEI Mate 80',
        'apple,mob,apple,Apple,"iPhone99,1",iPhone Test',
        'pad,pad,vivo,vivo,,vivo Pad',
        'watch,watch,vivo,vivo,,Watch',
        'unknown,mob,letv,乐视,,未知机型',
      ].join('\n')
    await fs.writeFile(sourcePath, csv)
    const workbook = Workbook.create()
    const sheet = workbook.worksheets.add('设备型号转译')
    sheet.getRange('A1:E2').values = [header, [20001, null, 'HUAWEI', 'phone', '华为 Mate 80']]
    sheet.tables.add('A1:E2', true, 'Devices')
    await (await SpreadsheetFile.exportXlsx(workbook)).save(initialPath)
    sheet.getRange('A2:E2').values = [[26070001, null, 'vivo', 'pad', 'vivo Pad']]
    await (await SpreadsheetFile.exportXlsx(workbook)).save(monthlyPath)
    await fs.writeFile(oldSql, 'old SQL')
    await fs.writeFile(oldReport, 'old report')
    const oldBytes = await fs.readFile(monthlyPath)
    const args = [
      '--source',
      sourcePath,
      '--target',
      initialPath,
      '--offline',
      '--month',
      '2026-10',
    ]
    await run([...args, '--initialize', '--dry-run'])
    expect(await fs.readdir(dir)).not.toContain('modelBak')
    expect(await fs.readFile(monthlyPath)).toEqual(oldBytes)
    const beforeInitialize = await fs.readFile(initialPath)
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(new Error('cleanup failed'))
    await expect(run([...args, '--initialize'])).rejects.toThrow('cleanup failed')
    unlinkSpy.mockRestore()
    expect(await fs.readFile(initialPath)).toEqual(beforeInitialize)
    expect(await fs.readFile(monthlyPath)).toEqual(oldBytes)
    expect(await fs.readFile(oldSql, 'utf8')).toBe('old SQL')
    expect(await fs.readFile(oldReport, 'utf8')).toBe('old report')
    expect(await fs.readdir(dir)).not.toContain('初始化报告.2026.json')
    await run([...args, '--initialize'])
    const names = await fs.readdir(dir)
    expect(names.filter((name) => name.endsWith('.xlsx'))).toEqual(['设备型号转译.xlsx'])
    expect(names.filter((name) => name.endsWith('.sql'))).toEqual(['yc_DeviceModelIntoName.sql'])
    expect(names).not.toContain(path.basename(oldReport))
    const initialized = await SpreadsheetFile.importXlsx(await FileBlob.load(initialPath))
    expect(initialized.worksheets.getItemAt(0).tables.items[0].getDataRows()).toEqual([
      [26000001, null, 'HUAWEI', 'phone', '华为 Mate 80'],
      [26000002, null, 'Apple', 'iPhone99,1', 'iPhone Test'],
      [26000003, null, 'vivo', 'pad', 'vivo Pad'],
    ])
    const report = JSON.parse(await fs.readFile(path.join(dir, '初始化报告.2026.json'), 'utf8'))
    expect(report.idMapping.map((row: { newId: number }) => row.newId)).toEqual([
      26000001, 26000003,
    ])
    expect(report.backups).toHaveLength(4)
    const monthlyBackup = report.backups.find(
      (entry: { filePath: string }) => entry.filePath === monthlyPath,
    )
    expect(await fs.readFile(monthlyBackup.backupPath)).toEqual(oldBytes)
    const sql = await fs.readFile(path.join(dir, 'yc_DeviceModelIntoName.sql'), 'utf8')
    expect(sql).toContain("(26000001,NULL,'华为 Mate 80','phone','HUAWEI')")
    expect(sql.match(/^\(/gm)).toHaveLength(3)
    const initialBytes = await fs.readFile(initialPath)
    await run(args)
    expect(await fs.readFile(initialPath)).toEqual(initialBytes)
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.xlsx'))).toHaveLength(1)
    await expect(run([...args, '--initialize', '--revalidate-all'])).rejects.toThrow('不能')
  })

  it('默认 Raw 地址连接失败时使用官方 API，自定义地址不切换数据源', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const csv = csvHeader + 'new,mob,vivo,vivo,,vivo Phone'
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'))
    const execFileImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('Raw unavailable'))
      .mockResolvedValueOnce({ stdout: csv })
    const response = await fetchSource(
      'https://raw.githubusercontent.com/KHwang9883/MobileModels-csv/main/models.csv',
      {},
      { fetchImpl, execFileImpl },
    )
    expect(await response.text()).toBe(csv)
    expect(execFileImpl.mock.calls[1]![1]).toContain('Accept: application/vnd.github.raw+json')
    expect(execFileImpl.mock.calls[1]![1].at(-1)).toBe(
      'https://api.github.com/repos/KHwang9883/MobileModels-csv/contents/models.csv?ref=main',
    )
    execFileImpl.mockRejectedValue(new Error('Custom source unavailable'))
    await expect(
      fetchSource('https://example.com/models.csv', {}, { fetchImpl, execFileImpl }),
    ).rejects.toThrow('Custom source unavailable')
    expect(execFileImpl).toHaveBeenCalledTimes(3)
  })

  it('筛选手机和平板，Apple 使用别名，按型号去重并沿用初始品牌', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'ignored,mob,apple,Apple,"iPhone99,1",iPhone Test',
          'duplicate,pad,apple,Apple,"iPhone99,1",iPad duplicate',
          'missing,mob,apple,Apple,,iPhone without alias',
          'known,mob,xiaomi,小米,,小米 old',
          'new,pad,xiaomi,小米,,小米 Pad',
          'h,mob,huawei,HUAWEI,,HUAWEI Test',
          'o,mob,honor,HONOR,,HONOR Test',
          's,mob,samsung,Samsung,,Galaxy Test',
          'watch,watch,vivo,vivo,,Watch',
          'typo,mod,vivo,vivo,,Typo',
          'computer,computer,xiaomi,小米,,Xiaomi Laptop',
          'excludedslash,mob,vivo,vivo,,vivo Pad / MagicBook',
          ...[
            '电脑',
            '笔记本',
            '游戏本',
            'MagicBook',
            'MateBook',
            '翻译机',
            '座舱',
            '汽车',
            '四足机器人',
          ].map((word, index) => `excluded${index},mob,huawei,HUAWEI,,${word}`),
        ].join('\n'),
    )
    const known = [[1, null, '小米', 'known', '小米 old']]
    const context = buildBrandContext(sourceRows, sourceIndexes, known, indexes)
    const { newRecords, stats } = buildNewRecords(
      sourceRows,
      sourceIndexes,
      known,
      indexes,
      context,
    )
    expect(
      newRecords.map(({ model, brand }: { model: string; brand: string }) => [model, brand]),
    ).toEqual([
      ['iPhone99,1', 'Apple'],
      ['new', 'Xiaomi'],
      ['h', 'HUAWEI'],
      ['o', 'HONOR'],
      ['s', 'Samsung'],
    ])
    expect(stats.skippedExcludedName).toBe(10)
    expect(stats.skippedOtherDtype).toBe(3)
    expect(stats.skippedAppleMissingCodeAlias).toBe(1)
    expect(stats.skippedSourceDuplicate).toBe(1)
    expect(stats.skippedExistingTarget).toBe(1)
  })

  it.each([
    ['realme', '真我 Pad', 'realme Pad'],
    ['realme', 'Pad 2', 'realme Pad 2'],
    ['realme', 'REALME Pad', 'realme Pad'],
    ['360', 'Pad', '360 Pad'],
    ['360', '360 手机', '360 手机'],
    ['努比亚', 'Pad', 'Nubia Pad'],
    ['努比亚', '红魔 Pad', '红魔 Pad'],
    ['vivo', 'Pad', 'vivo Pad'],
    ['vivo', 'iQOO Pad', 'iQOO Pad'],
    ['Sony', 'Xperia', 'Sony Xperia'],
    ['索尼', 'SONY Xperia', 'Sony Xperia'],
    ['Sony', '索尼 Xperia', 'Sony Xperia'],
    ['Xiaomi', 'Xiaomi Pad 9', '小米平板 9'],
    ['Xiaomi', 'Xiaomi15', '小米15'],
    ['Xiaomi', 'Xiaomi   Pad 9', '小米平板 9'],
    ['Xiaomi', 'REDMI K90', '红米 K90'],
    ['Xiaomi', 'REDMIK90', '红米K90'],
    ['Xiaomi', 'Redmi\tPad 2', '红米平板 2'],
    ['Xiaomi', '  Xiaomi Pad / REDMI Pad  ', '小米平板'],
    ['Xiaomi', 'xiaomi redmi', '小米 redmi'],
    ['Xiaomi', '小米 Pad', '小米平板'],
    ['小米', '  红米 Pad  ', '红米平板'],
    ['HONOR', 'HONOR Magic8 Pro', '荣耀 Magic8 Pro'],
    ['HUAWEI', 'huawei MatePad Pro 13.2 英寸', '华为 MatePad Pro 13.2 英寸'],
    ['HUAWEI', 'Mate 80', '华为 Mate 80'],
    ['HONOR', 'PORSCHE DESIGN HONOR Magic V2 RSR', 'PORSCHE DESIGN HONOR Magic V2 RSR'],
    ['HUAWEI', 'PORSCHE DESIGN HUAWEI Mate RS', 'PORSCHE DESIGN HUAWEI Mate RS'],
    ['Xiaomi', 'Leica Leitzphone powered by Xiaomi', 'Leica Leitzphone powered by Xiaomi'],
    ['Xiaomi', 'Leica Xiaomi Pad', 'Leica Xiaomi Pad'],
    ['Xiaomi', 'Xiaomi 17 Ultra by Leica', '小米 17 Ultra by Leica'],
    ['Xiaomi', 'Phone by REDMI', 'Phone by REDMI'],
    ['HUAWEI', 'HUAWEI Mate HONOR Edition', '华为 Mate HONOR Edition'],
    ['HONOR', '  honor Magic8 / second  ', '荣耀 Magic8'],
    ['HONOR', '荣耀 Honor', '荣耀'],
    ['HONOR', '荣耀 Honor+', '荣耀+'],
    ['HONOR', 'HONOR Honor', '荣耀'],
    ['HONOR', 'HONOR Honor+', '荣耀+'],
    ['HONOR', '荣耀 honor+', '荣耀+'],
    ['HONOR', '荣耀 Honor 8', '荣耀 Honor 8'],
    ['realme', '真我 GT7T 5G', 'realme GT 7T 5G'],
    ['vivo', 'IQOO Neo11 至尊版', 'iQOO Neo11 至尊版'],
    ['Nubia', '努比亚 Z80 Ultra', 'Nubia Z80 Ultra'],
    ['Apple', 'iPad Pro (11 英寸, M4)', 'iPad Pro (11 英寸, M4)'],
    ['Nothing', 'Nothing Phone (2a) Plus', 'Nothing Phone (2a) Plus'],
    ['乐视', '未知机型', ''],
    ['乐视', 'N/A', ''],
    ['realme', '  Pad / 真我 Pad  ', 'realme Pad'],
    ['vivo', '  vivo Pad / iQOO Pad  ', 'vivo Pad'],
    ['Sony', ' Xperia / Sony Xperia ', 'Sony Xperia'],
    ['vivo', 'vivo Pad / second / third', 'vivo Pad'],
    ['vivo', ' / vivo Pad', ''],
  ])('品牌 %s 的名称 %s 转换为 %s', (brand, name, expected) => {
    const context = {
      aliasesByBrand: new Map(),
      knownNameTokensByBrand: new Map([['apple', new Set(['ipad'])]]),
    }
    expect(normalizeModelName(name, brand, context, [], indexes).name).toBe(expected)
    expect(normalizeModelName(expected, brand, context, [], indexes).name).toBe(expected)
  })

  it('类型全部不匹配时拒绝源数据，防止把 mod 拼写当作手机', async () => {
    await expect(loadSource(csvHeader + 'test,mod,vivo,vivo,,Phone')).rejects.toThrow('不是 mod')
  })

  it('未知名称待确认，人工覆盖按品牌型号匹配且不能绕过类型或名称排除', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'unknown,mob,letv,乐视,,未知机型',
          'leica,mob,xiaomi,Xiaomi,,Leica Leitzphone powered by Xiaomi',
          'watch,watch,xiaomi,Xiaomi,,Watch',
          'computer,mob,xiaomi,Xiaomi,,MagicBook',
          'h,mob,huawei,HUAWEI,,HUAWEI Mate',
          'other,mob,letv,乐视,,unknown model',
        ].join('\n'),
    )
    const plainContext = buildBrandContext(sourceRows, sourceIndexes, [], indexes)
    const plain = buildNewRecords(sourceRows, sourceIndexes, [], indexes, plainContext)
    expect(plain.stats.skippedUnknownName).toBe(2)
    expect(analyzeSourceModels(sourceRows, sourceIndexes, plainContext).pendingNames).toHaveLength(
      2,
    )
    const overrides = [
      { brand: '乐视', model: 'unknown', name: '乐视 已确认名称' },
      { brand: '小米', model: 'leica', name: 'Leica Leitzphone powered by Xiaomi' },
      { brand: 'Xiaomi', model: 'watch', name: '小米 手机' },
      { brand: 'Xiaomi', model: 'computer', name: '小米 手机' },
      { brand: '华为', model: 'h', name: ' HUAWEI Mate 已确认版 ' },
    ]
    const context = buildBrandContext(sourceRows, sourceIndexes, [], indexes, overrides)
    const result = buildNewRecords(sourceRows, sourceIndexes, [], indexes, context)
    expect(
      result.newRecords.map((r: { model: string; name: string }) => [r.model, r.name]),
    ).toEqual([
      ['unknown', '乐视 已确认名称'],
      ['leica', 'Leica Leitzphone powered by Xiaomi'],
      ['h', '华为 Mate 已确认版'],
    ])
    const monthly = { rows: [[26100001, null, '乐视', 'unknown', '未知机型']], indexes }
    expect(
      revalidateMonthlyRows(monthly, sourceRows, sourceIndexes, plainContext).removedRows[0].reason,
    ).toBe('UNKNOWN_NAME')
    expect(revalidateMonthlyRows(monthly, sourceRows, sourceIndexes, context).rows).toHaveLength(1)
    expect(() =>
      buildBrandContext(sourceRows, sourceIndexes, [], indexes, [
        overrides[1],
        { brand: 'Xiaomi', model: 'leica', name: '重复' },
      ]),
    ).toThrow('重复')
    expect(() =>
      buildBrandContext(sourceRows, sourceIndexes, [], indexes, [
        { brand: 'Xiaomi', model: 'test', name: '手机 / 笔记本' },
      ]),
    ).toThrow('不合规')
    expect(() =>
      buildBrandContext(sourceRows, sourceIndexes, [], indexes, [
        { brand: 'Xiaomi', model: 'test', name: 'N/A' },
      ]),
    ).toThrow('不合规')
  })

  it('仅提示名称词序疑似别名，保留所有版本信息与型号', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'global,mob,xiaomi,Xiaomi,,Xiaomi 11 Lite 5G NE',
          'india,mob,xiaomi,Xiaomi,,Xiaomi 11 Lite NE 5G',
          'four,mob,xiaomi,Xiaomi,,Xiaomi 11 Lite 4G NE',
        ].join('\n'),
    )
    const context = buildBrandContext(sourceRows, sourceIndexes, [], indexes)
    const audit = analyzeSourceModels(sourceRows, sourceIndexes, context)
    expect(audit.suspectedAliases).toEqual([
      {
        brand: 'Xiaomi',
        names: ['小米 11 Lite 5G NE', '小米 11 Lite NE 5G'],
        models: ['global', 'india'],
      },
    ])
    expect(
      buildNewRecords(sourceRows, sourceIndexes, [], indexes, context).newRecords,
    ).toHaveLength(3)
  })

  it('只接受 mob/pad，拒绝其余类型，并报告跨品牌型号冲突', async () => {
    const dtypes = [
      'mob',
      'pad',
      'mod',
      'computer',
      'watch',
      'band',
      'ivi',
      'accessory',
      'tv_hub',
      'tv',
      'pod',
      'glass',
      'mob-extra',
    ]
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          ...dtypes.map((dtype) => `${dtype},${dtype},vivo,vivo,,vivo ${dtype}`),
          'shared,pad,honor,荣耀,,荣耀平板',
          'shared,pad,huawei,华为,,华为平板',
        ].join('\n'),
    )
    const context = buildBrandContext(sourceRows, sourceIndexes, [], indexes)
    const { newRecords, stats } = buildNewRecords(sourceRows, sourceIndexes, [], indexes, context)
    expect(newRecords.map((record: { model: string }) => record.model)).toEqual([
      'mob',
      'pad',
      'shared',
    ])
    expect(stats.skippedOtherDtype).toBe(dtypes.length - 2)
    const audit = analyzeSourceModels(sourceRows, sourceIndexes, context)
    expect(audit.eligibleUniqueModels).toBe(3)
    expect(audit.ambiguousModels).toEqual([
      { model: 'shared', brands: ['HONOR', 'HUAWEI'], names: ['荣耀平板', '华为平板'] },
    ])
  })

  it('同一型号任一 mob/pad 源名称命中排除词时，英文别名也不能绕过过滤', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'translator,mob,xiaomi,小米,,Xiaomi Mijia Translator',
          'translator,mob,xiaomi,小米,,小米米家翻译机',
          'screen,mob,xiaomi,小米,,Xiaomi EV Back Row Mobile Control Screen',
          'screen,mob,xiaomi,小米,,小米汽车后排移动控制屏',
          'pad,pad,vivo,vivo,,vivo Pad',
        ].join('\n'),
    )
    const context = buildBrandContext(sourceRows, sourceIndexes, [], indexes)
    const { newRecords } = buildNewRecords(sourceRows, sourceIndexes, [], indexes, context)
    expect(newRecords.map((row: { model: string }) => row.model)).toEqual(['pad'])
  })

  it('品牌固定映射优先，其余优先目标英文名，再使用源英文显示名', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'h,mob,huawei,华为,,Phone',
          'o,mob,honor,荣耀,,Phone',
          's,mob,sony,索尼,,Phone',
          'sam,mob,samsung,三星,,Phone',
          'mi,mob,xiaomi,小米,,Phone',
          'r,mob,redmi,红米,,Phone',
          'n,mob,nubia,努比亚,,Phone',
          'n2,mob,nubia,Nubia,,Phone',
          'a,mob,asus,Asus,,Phone',
          'l,mob,lenovo,联想,,Phone',
        ].join('\n'),
    )
    const targets = [
      [1, null, 'ASUS', 'old-asus', 'ASUS Phone'],
      [2, null, '努比亚', 'old-nubia', '努比亚 Phone'],
    ]
    const context = buildBrandContext(sourceRows, sourceIndexes, targets, indexes)
    expect(Object.fromEntries(context.canonicalByKey)).toEqual({
      huawei: 'HUAWEI',
      honor: 'HONOR',
      sony: 'Sony',
      samsung: 'Samsung',
      xiaomi: 'Xiaomi',
      redmi: 'REDMI',
      nubia: 'Nubia',
      asus: 'ASUS',
      lenovo: '联想',
    })
  })

  it('重新筛选月份记录，只保留源中可验证的 mob/pad，并区分移出原因', async () => {
    const { sourceRows, sourceIndexes } = await loadSource(
      csvHeader +
        [
          'phone,mob,vivo,vivo,,vivo Phone',
          'pad,pad,vivo,vivo,,vivo Pad',
          'watch,watch,vivo,vivo,,vivo Watch',
          'dog,accessory,xiaomi,小米,,CyberDog',
          'car,ivi,xiaomi,小米,,EV Cockpit',
          'translator,mob,xiaomi,小米,,Xiaomi Translator',
          'translator,mob,xiaomi,小米,,翻译机',
          'empty,mob,vivo,vivo,, / alternate',
        ].join('\n'),
    )
    const records = ['phone', 'pad', 'watch', 'dog', 'car', 'translator', 'empty', 'unknown'].map(
      (model, index) => [26100001 + index, null, 'vivo', model, `vivo ${model}`],
    )
    const result = revalidateMonthlyRows({ rows: records, indexes }, sourceRows, sourceIndexes)
    expect(result.rows).toEqual(records.slice(0, 2))
    expect(
      result.removedRows.map((row: { model: string; reason: string }) => [row.model, row.reason]),
    ).toEqual([
      ['watch', 'DTYPE_NOT_ALLOWED'],
      ['dog', 'DTYPE_NOT_ALLOWED'],
      ['car', 'DTYPE_NOT_ALLOWED'],
      ['translator', 'EXCLUDED_NAME_KEYWORD'],
      ['empty', 'INVALID_SOURCE_RECORD'],
      ['unknown', 'SOURCE_MODEL_NOT_FOUND'],
    ])
  })

  it('按北京时间格式化备份时间和月份，跨文件续号并拒绝序号溢出', () => {
    expect(formatBackupTimestamp(new Date('2026-10-21T16:00:00Z'))).toBe('20261022000000')
    expect(formatBackupTimestamp(new Date('2026-10-22T06:14:38.660Z'))).toBe('20261022141438')
    expect(localMonthString(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10')
    expect(getNextMonthSequence([[26100020], [26100003], [26090099], [20001]], 0, '2026-10')).toBe(
      21,
    )
    const records = [{ brand: 'Apple', model: 'iPad99,1', name: 'iPad' }]
    expect(toMonthTargetRows(records, indexes, '2026-10', 21, 5)[0]).toEqual([
      26100021,
      null,
      'Apple',
      'iPad99,1',
      'iPad',
    ])
    expect(() => toMonthTargetRows(records, indexes, '2026-10', 10000, 5)).toThrow('9999')
  })

  it('SQL 每 200 条分批，保持字段顺序并转义引号和反斜杠', () => {
    const rows = Array.from({ length: 401 }, (_, index) => [
      26100001 + index,
      null,
      'Apple',
      `model${index}`,
      "O'Brien\\Pad",
    ])
    const sql = buildTiDbInsertSql(rows, indexes, 200)
    const statements = sql
      .trim()
      .split(';')
      .filter((statement: string) => statement.trim())
    expect(
      statements.map(
        (statement: string) =>
          statement.split('\n').filter((line: string) => line.startsWith('(')).length,
      ),
    ).toEqual([200, 200, 1])
    expect(sql).toContain("(26100001,NULL,'O''Brien\\\\Pad','model0','Apple')")
    expect(buildTiDbInsertSql([], indexes, 200)).not.toContain('insert into')
  })

  it('SQL 忽略全空行，过滤后再按 200 条分批，不能生成 ID 为 0 的空记录', () => {
    const rows = Array.from({ length: 201 }, (_, index) => [
      26100001 + index,
      null,
      'vivo',
      `model${index}`,
      'vivo Pad',
    ])
    const blank = [null, null, null, null, null]
    const sql = buildTiDbInsertSql(
      [blank, ...rows.flatMap((row) => [row, blank]), ['', ' ', null, '', null]],
      indexes,
      200,
    )
    expect(sql.match(/^\(/gm)).toHaveLength(201)
    expect(sql.match(/insert into/g)).toHaveLength(2)
    expect(sql).not.toContain('(0,')
    expect(buildTiDbInsertSql([blank, ['', ' ', null, '', null]], indexes, 200)).not.toContain(
      'insert into',
    )
  })

  it('仅全量处理初始文件时允许保留历史正整数 ID，仍拒绝 0', () => {
    const legacy = [20001, null, 'Apple', 'iPhone1,1', 'iPhone']
    expect(() => buildTiDbInsertSql([legacy], indexes, 200)).toThrow('8 位')
    expect(buildTiDbInsertSql([legacy], indexes, 200, { allowLegacyIds: true })).toContain(
      '(20001,NULL,',
    )
    expect(() =>
      buildTiDbInsertSql([[0, null, 'Apple', 'model', 'Phone']], indexes, 200, {
        allowLegacyIds: true,
      }),
    ).toThrow()
  })

  it('全量处理初始及所有月份：规范品牌、过滤、去重、保留 ID 并同步 SQL', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'device-models-all-'))
    directories.push(dir)
    const initialPath = path.join(dir, '设备型号转译.xlsx')
    const sourcePath = path.join(dir, 'models.csv')
    await fs.writeFile(
      sourcePath,
      csvHeader +
        [
          'h,mob,huawei,华为,,HUAWEI Mate',
          'watch,watch,vivo,vivo,,vivo Watch',
          's,mob,sony,Sony,,Xperia',
          'mi,mob,xiaomi,Xiaomi,,REDMI Note',
          'pad,pad,vivo,vivo,,Pad',
          'car,ivi,xiaomi,Xiaomi,,Car',
          'shared,pad,honor,荣耀,,荣耀 Pad',
          'shared,pad,huawei,华为,,华为 Pad',
          '12345,mob,vivo,vivo,,vivo Phone',
          'unknown,mob,letv,乐视,,未知机型',
        ].join('\n'),
    )
    const fixtures = [
      [
        '设备型号转译.xlsx',
        [
          [20001, null, '华为', 'h', '旧名'],
          [20002, null, 'vivo', 'watch', 'Watch'],
          [20003, null, '华为', 'shared', '旧华为平板'],
          [20004, null, 'vivo', 12345, ' vivo Phone '],
          [20005, null, '乐视', 'unknown', '未知机型'],
        ],
      ],
      [
        '设备型号转译.2026-06.xlsx',
        [
          [26060001, null, '华为', 'h', '重复'],
          [26060002, null, '索尼', 's', '索尼 Xperia'],
        ],
      ],
      [
        '设备型号转译.2026-07.xlsx',
        [
          [26070001, null, '小米', 'mi', '红米 Note'],
          [26070002, null, '小米', 'mi', '红米 Note'],
        ],
      ],
      [
        '设备型号转译.2026-10.xlsx',
        [
          [26100001, null, 'vivo', 'pad', 'vivo Pad'],
          [26100002, null, '小米', 'car', 'Car'],
        ],
      ],
    ] as const
    for (const [file, rows] of fixtures) {
      const w = Workbook.create()
      const sheet = w.worksheets.add('设备型号转译')
      sheet.getRangeByIndexes(0, 0, rows.length + 1, 5).values = [header, ...rows]
      sheet.tables.add(`A1:E${rows.length + 1}`, true, 'Devices')
      await (await SpreadsheetFile.exportXlsx(w)).save(path.join(dir, file))
    }
    const args = ['--source', sourcePath, '--target', initialPath, '--offline', '--revalidate-all']
    const original = await fs.readFile(initialPath)
    await run([...args, '--dry-run'])
    expect(await fs.readFile(initialPath)).toEqual(original)
    await run(args)
    const expected = [
      [
        [20001, null, 'HUAWEI', 'h', '华为 Mate'],
        [20003, null, 'HUAWEI', 'shared', '华为 Pad'],
        [20004, null, 'vivo', '12345', 'vivo Phone'],
      ],
      [[26060002, null, 'Sony', 's', 'Sony Xperia']],
      [[26070001, null, 'Xiaomi', 'mi', '红米 Note']],
      [[26100001, null, 'vivo', 'pad', 'vivo Pad']],
    ]
    for (const [index, [file]] of fixtures.entries()) {
      const w = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(dir, file)))
      expect(w.worksheets.getItemAt(0).tables.items[0].getDataRows()).toEqual(expected[index])
      const sqlFile =
        index === 0
          ? 'yc_DeviceModelIntoName.sql'
          : file.replace('设备型号转译', 'yc_DeviceModelIntoName').replace('.xlsx', '.sql')
      const sql = await fs.readFile(path.join(dir, sqlFile), 'utf8')
      expect(sql.match(/^\(/gm)).toHaveLength(expected[index]!.length)
      expect(sql).not.toContain('(0,')
    }
    const reports = (await fs.readdir(path.join(dir, 'modelBak'))).filter((name) =>
      name.startsWith('revalidate-all.'),
    )
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatch(/^revalidate-all\.\d{14}\.[\da-f-]+\.json$/)
    const report = JSON.parse(await fs.readFile(path.join(dir, 'modelBak', reports[0]!), 'utf8'))
    expect(report.files.map((file: { afterRows: number }) => file.afterRows)).toEqual([3, 1, 1, 1])
    expect(report.files[0].normalizedModels).toBe(1)
    expect(report.sourceAudit.ambiguousModels).toHaveLength(1)
    expect(report.sourceAudit.pendingNames).toHaveLength(1)
    expect(
      report.files[0].removedRows.some((row: { reason: string }) => row.reason === 'UNKNOWN_NAME'),
    ).toBe(true)
    expect(report.backups).toHaveLength(4)
    await run(args)
    const overridePath = path.join(dir, 'names.json')
    await fs.writeFile(
      overridePath,
      JSON.stringify([{ brand: '华为', model: 'h', name: 'HUAWEI Mate 确认版' }]),
    )
    await run([...args, '--name-overrides', overridePath])
    const overridden = await SpreadsheetFile.importXlsx(await FileBlob.load(initialPath))
    expect(overridden.worksheets.getItemAt(0).tables.items[0].getDataRows()[0]).toEqual([
      20001,
      null,
      'HUAWEI',
      'h',
      '华为 Mate 确认版',
    ])
  }, 30_000)

  it.each([
    [null, null, 'vivo', 'model', 'vivo Pad'],
    [0, null, 'vivo', 'model', 'vivo Pad'],
    [26100001, null, null, 'model', 'vivo Pad'],
    [26100001, null, 'vivo', '', 'vivo Pad'],
    [26100001, null, 'vivo', 'model', ' '],
  ])('SQL 拒绝非空但缺少必填字段的记录 %j', (...row) => {
    expect(() => buildTiDbInsertSql([row], indexes, 200)).toThrow('无法生成 SQL')
  })

  it('端到端备份、下载、跨目录排除历史数据，同月重复运行后继续追加', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'device-models-'))
    directories.push(dir)
    const initialPath = path.join(dir, '设备型号转译.xlsx')
    const sourcePath = path.join(dir, 'models.csv')
    const outputPath = path.join(dir, 'out', '设备型号转译.2026-10.xlsx')
    const workbook = Workbook.create()
    const sheet = workbook.worksheets.add('设备型号转译')
    sheet.getRange('A1:E2').values = [header, [1, null, 'vivo', 'known', 'vivo Old']]
    sheet.tables.add('A1:E4', true, 'Devices')
    await (await SpreadsheetFile.exportXlsx(workbook)).save(initialPath)
    sheet.getRange('A2:E2').values = [[26100009, null, 'vivo', 'history', 'vivo History']]
    await (
      await SpreadsheetFile.exportXlsx(workbook)
    ).save(path.join(dir, '设备型号转译.2026-09.xlsx'))
    const initialBytes = await fs.readFile(initialPath)
    await fs.writeFile(sourcePath, 'original CSV')
    const csv =
      csvHeader +
      'known,mob,vivo,vivo,,Old\nhistory,pad,vivo,vivo,,History\n00123,pad,vivo,vivo,,Pad\n'
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(csv))
    const args = [
      '--source',
      sourcePath,
      '--target',
      initialPath,
      '--output',
      outputPath,
      '--month',
      '2026-10',
    ]
    await run(args, { fetchImpl })
    expect(
      (await fs.readdir(path.dirname(outputPath))).filter((name) => name.includes('.tmp-')),
    ).toEqual([])
    const readRows = async () => {
      const result = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath))
      return result.worksheets.getItemAt(0).tables.items[0].getDataRows()
    }
    expect(await readRows()).toEqual([[26100010, null, 'vivo', '00123', 'vivo Pad']])
    const backupPaths = await fs.readdir(path.join(dir, 'modelBak'))
    expect(backupPaths).toHaveLength(1)
    expect(backupPaths[0]).toMatch(/^models\.csv\.\d{14}\.[\da-f-]+\.bak$/)
    expect(await fs.readFile(path.join(dir, 'modelBak', backupPaths[0]!), 'utf8')).toBe(
      'original CSV',
    )
    expect(await fs.readFile(sourcePath, 'utf8')).toBe(csv)
    const firstBytes = await fs.readFile(outputPath)
    await run(args, { fetchImpl })
    expect(await fs.readFile(outputPath)).toEqual(firstBytes)
    fetchImpl.mockImplementation(async () => new Response(csv + 'second,mob,vivo,vivo,,New\n'))
    await run(args, { fetchImpl })
    expect(await readRows()).toEqual([
      [26100010, null, 'vivo', '00123', 'vivo Pad'],
      [26100011, null, 'vivo', 'second', 'vivo New'],
    ])
    const sql = await fs.readFile(
      path.join(dir, 'out', 'yc_DeviceModelIntoName.2026-10.sql'),
      'utf8',
    )
    expect(sql).toContain("(26100010,NULL,'vivo Pad','00123','vivo')")
    expect(sql).toContain("(26100011,NULL,'vivo New','second','vivo')")
    expect(await fs.readFile(initialPath)).toEqual(initialBytes)
    const staleWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath))
    staleWorkbook.worksheets.getItemAt(0).getRange('E2').values = [[' old / alternate ']]
    await (await SpreadsheetFile.exportXlsx(staleWorkbook)).save(outputPath)
    const beforeNormalize = await fs.readFile(outputPath)
    const normalizeArgs = [...args, '--offline', '--normalize-current-month']
    await run([...normalizeArgs, '--dry-run'], { fetchImpl })
    expect(await fs.readFile(outputPath)).toEqual(beforeNormalize)
    await run(normalizeArgs, { fetchImpl })
    expect(await readRows()).toEqual([
      [26100010, null, 'vivo', '00123', 'vivo Pad'],
      [26100011, null, 'vivo', 'second', 'vivo New'],
    ])
    const outputBackups = await fs.readdir(path.join(dir, 'out', 'modelBak'))
    expect(outputBackups.some((name) => name.startsWith('设备型号转译.2026-10.xlsx.'))).toBe(true)
    expect(
      outputBackups.some((name) => name.startsWith('yc_DeviceModelIntoName.2026-10.sql.')),
    ).toBe(true)
    const afterNormalize = await fs.readFile(outputPath)
    await run(normalizeArgs, { fetchImpl })
    expect(await fs.readFile(outputPath)).toEqual(afterNormalize)
    const paddedWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath))
    const paddedSheet = paddedWorkbook.worksheets.getItemAt(0)
    paddedSheet.tables.items[0].delete()
    paddedSheet.tables.add('A1:E20', true, 'Devices')
    await (await SpreadsheetFile.exportXlsx(paddedWorkbook)).save(outputPath)
    await run([...args, '--offline'], { fetchImpl })
    const paddedSql = await fs.readFile(
      path.join(dir, 'out', 'yc_DeviceModelIntoName.2026-10.sql'),
      'utf8',
    )
    expect(paddedSql.match(/^\(/gm)).toHaveLength(2)
    expect(paddedSql).not.toContain('(0,')
    paddedSheet.getRange('A4:E5').values = [
      [26100012, null, 'vivo', 'bad-watch', 'vivo Watch'],
      [26100013, null, 'vivo', 'unknown', 'vivo Unknown'],
    ]
    await (await SpreadsheetFile.exportXlsx(paddedWorkbook)).save(outputPath)
    await fs.appendFile(sourcePath, 'bad-watch,watch,vivo,vivo,,vivo Watch\n')
    const beforeRevalidate = await fs.readFile(outputPath)
    const revalidateArgs = [...args, '--offline', '--revalidate-current-month']
    await run([...revalidateArgs, '--dry-run'], { fetchImpl })
    expect(await fs.readFile(outputPath)).toEqual(beforeRevalidate)
    await run(revalidateArgs, { fetchImpl })
    expect(await readRows()).toEqual([
      [26100010, null, 'vivo', '00123', 'vivo Pad'],
      [26100011, null, 'vivo', 'second', 'vivo New'],
    ])
    const reports = (await fs.readdir(path.join(dir, 'out', 'modelBak'))).filter((name) =>
      name.endsWith('.filtered-rows.json'),
    )
    expect(reports).toHaveLength(1)
    const report = JSON.parse(
      await fs.readFile(path.join(dir, 'out', 'modelBak', reports[0]!), 'utf8'),
    )
    expect(report.removedRows.map((row: { reason: string }) => row.reason)).toEqual([
      'DTYPE_NOT_ALLOWED',
      'SOURCE_MODEL_NOT_FOUND',
    ])
    const afterRevalidate = await fs.readFile(outputPath)
    await run(revalidateArgs, { fetchImpl })
    expect(await fs.readFile(outputPath)).toEqual(afterRevalidate)
    const beforeDryRun = await fs.readdir(path.join(dir, 'modelBak'))
    await run([...args, '--dry-run'], { fetchImpl })
    expect(await fs.readdir(path.join(dir, 'modelBak'))).toEqual(beforeDryRun)
    fetchImpl.mockImplementation(async () => new Response('<html>not CSV</html>'))
    const savedSource = await fs.readFile(sourcePath)
    await expect(run(args, { fetchImpl })).rejects.toThrow('缺少字段')
    expect(await fs.readFile(sourcePath)).toEqual(savedSource)
    fetchImpl.mockImplementation(async () => new Response('Unavailable', { status: 503 }))
    await expect(run(args, { fetchImpl })).rejects.toThrow('HTTP 503')
    expect(await fs.readFile(sourcePath)).toEqual(savedSource)
    fetchImpl.mockRejectedValue(new Error('timeout'))
    await expect(run(args, { fetchImpl })).rejects.toThrow('timeout')
    await run([...args, '--offline'], { fetchImpl })
  }, 30_000)
})
