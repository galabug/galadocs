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
  const localized = cleaned.replace(/^(honor|huawei)/i, (value) =>
    value.toLowerCase() === 'honor' ? '荣耀' : '华为',
  )
  return {
    name: unknown ? '' : localized.replace(/^荣耀\s*honor(\+)?$/i, '荣耀$1'),
    overridden: override !== undefined,
    unknown,
  }
}

export function normalizeNameStyle(name, brand) {
  const key = String(brand).trim().toLowerCase()
  if (key === 'apple') {
    return name.replace(/^(.*?)\s*[（(]([^()（）]*)[)）](.*)$/, (original, series, details, suffix) => {
      const parts = details.split(/[,，]/).map((part) => part.trim())
      const generations = parts.filter((part) => /^第\s*\d+\s*代$/.test(part))
      if (generations.length !== 1) return original
      const generation = generations[0].match(/\d+/)[0]
      const remaining = parts
        .filter((part) => part !== generations[0])
        .map((part) => part.replace(/(\d)\s+英寸/g, '$1英寸'))
        .join(', ')
      return `${series.trim()} ${generation}${remaining ? `(${remaining})` : ''}${suffix}`
    })
  }
  if (['xiaomi', '小米', 'redmi', '红米'].includes(key)) {
    return name
      .replace(/^(xiaomi|redmi)/i, (value) => (value.toLowerCase() === 'xiaomi' ? '小米' : '红米'))
      .replace(/^(小米|红米)\s*pad\b/i, '$1平板')
      .replace(/^(小米|红米)\s+平板/, '$1平板')
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
