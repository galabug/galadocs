export function cleanDeviceName(value) {
  return String(value ?? '')
    .split('/')[0]
    .replace(/\s+/g, ' ')
    .trim()
}

export function isUnknownName(value) {
  return /^(?:未知(?:机型|型号|设备)?|unknown(?:\s+(?:model|device|phone))?|n\/a|待确认|未识别|其他|other)$/i.test(
    String(value ?? '').trim(),
  )
}

export function nameOverrideKey(brand, model) {
  return `${String(brand).trim().toLowerCase()}\0${String(model).trim()}`
}

export function selectDeviceName(name, brand, model, context) {
  const canonical = context?.canonicalByAlias?.get(String(brand).trim().toLowerCase()) ?? brand
  const override = context?.nameOverrides?.get(nameOverrideKey(canonical, model))
  const selected = override ?? name
  const cleaned = cleanDeviceName(selected)
  const unknown = isUnknownName(selected) || isUnknownName(cleaned)
  return {
    name: unknown ? '' : cleaned.replace(/honor/gi, '荣耀').replace(/huawei/gi, '华为'),
    overridden: override !== undefined,
    unknown,
  }
}

export function normalizeNameStyle(name, brand) {
  const key = String(brand).trim().toLowerCase()
  if (['xiaomi', '小米', 'redmi', '红米'].includes(key)) {
    return name
      .replace(/xiaomi/gi, '小米')
      .replace(/redmi/gi, '红米')
      .replace(/(小米|红米)\s*pad\b/gi, '$1平板')
      .replace(/(小米|红米)\s+平板/g, '$1平板')
  }
  if (['realme', '真我'].includes(key)) {
    return name.replace(/真我|realme/gi, 'realme').replace(/\bgt\s*(\d+)/gi, 'GT $1')
  }
  if (['nubia', '努比亚'].includes(key)) return name.replace(/nubia|努比亚/gi, 'Nubia')
  if (key === 'vivo') return name.replace(/vivo/gi, 'vivo').replace(/iqoo/gi, 'iQOO')
  if (['sony', '索尼'].includes(key)) return name.replace(/sony|索尼/gi, 'Sony')
  return name
}

// Only flag token-order or case variants. Keep all versions and models unchanged.
export function findNameAliasCandidates(records) {
  const groups = new Map()
  for (const record of records) {
    const tokens = record.name.toLowerCase().split(/\s+/).sort()
    const key = `${record.brand.toLowerCase()}\0${tokens.join(' ')}`
    const group = groups.get(key) ?? { brand: record.brand, names: new Set(), models: new Set() }
    group.names.add(record.name)
    group.models.add(record.model)
    groups.set(key, group)
  }
  return [...groups.values()]
    .filter((group) => group.names.size > 1)
    .map((group) => ({ brand: group.brand, names: [...group.names], models: [...group.models] }))
}
