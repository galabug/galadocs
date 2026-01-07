// 计算男性职工的新退休年龄
function calculateMaleRetirement(year, month) {
  const originalRetirementAge = 60;
  const finalRetirementAge = 63;
  const retirementYear = year + originalRetirementAge;
  const retirementMonth = month;

  let delayMonths = 0;
  if (retirementYear >= 2025) {
    // 从2025年1月开始的延迟退休
    if (retirementYear > 2025) {
      delayMonths += 3 * ((retirementYear - 2025));
    }
    delayMonths += Math.ceil((retirementMonth) / 4); // 每4个月延1个月

    // 如果超过了最终退休年龄，则设置为最终退休年龄
    if (delayMonths > (finalRetirementAge - originalRetirementAge) * 12) {
      delayMonths = (finalRetirementAge - originalRetirementAge) * 12;
    }
  }

  const newRetirementYear = retirementYear + Math.floor(delayMonths / 12);
  const newRetirementMonth = (retirementMonth + delayMonths % 12) % 12;
  const retirementAge = originalRetirementAge + Math.floor(delayMonths / 12) + (delayMonths % 12 ? 1 : 0);
  let ageMonthStr = delayMonths % 12 == 0 ? '' : delayMonths % 12 + '个月'

  return {
    retirementAge: `${retirementAge}岁${ageMonthStr}`,
    retirementTime: `${newRetirementYear}-${String(newRetirementMonth + 1).padStart(2, '0')}`,
    delayMonths: delayMonths
  };
}

// 计算原定50岁退休女性职工的新退休年龄
function calculateFemaleRetirement50(year, month) {
  const originalRetirementAge = 50;
  const finalRetirementAge = 55;
  const retirementYear = year + originalRetirementAge;
  const retirementMonth = month;

  let delayMonths = 0;
  if (retirementYear >= 2025) {
    if (retirementYear > 2025) {
      delayMonths += 6 * ((retirementYear - 2025));
    }
    delayMonths += Math.ceil((retirementMonth) / 2); // 每2个月延1个月

    if (delayMonths > (finalRetirementAge - originalRetirementAge) * 12) {
      delayMonths = (finalRetirementAge - originalRetirementAge) * 12;
    }
  }

  const newRetirementYear = retirementYear + Math.floor(delayMonths / 12);
  const newRetirementMonth = (retirementMonth + delayMonths % 12) % 12;
  const retirementAge = originalRetirementAge + Math.floor(delayMonths / 12) + (delayMonths % 12 ? 1 : 0);
  let ageMonthStr = delayMonths % 12 == 0 ? '' : delayMonths % 12 + '个月'

  return {
    retirementAge: `${retirementAge}岁${ageMonthStr}`,
    retirementTime: `${newRetirementYear}-${String(newRetirementMonth + 1).padStart(2, '0')}`,
    delayMonths: delayMonths
  };
}

// 计算原定55岁退休女性职工的新退休年龄
function calculateFemaleRetirement55(year, month) {
  const originalRetirementAge = 55;
  const finalRetirementAge = 58;
  const retirementYear = year + originalRetirementAge;
  const retirementMonth = month;

  let delayMonths = 0;
  if (retirementYear >= 2025) {
    if (retirementYear > 2025) {
      delayMonths += 3 * ((retirementYear - 2025));
    }
    delayMonths += Math.ceil((retirementMonth) / 4); // 每4个月延1个月

    if (delayMonths > (finalRetirementAge - originalRetirementAge) * 12) {
      delayMonths = (finalRetirementAge - originalRetirementAge) * 12;
    }
  }

  const newRetirementYear = retirementYear + Math.floor(delayMonths / 12);
  const newRetirementMonth = (retirementMonth + delayMonths % 12) % 12;
  const retirementAge = originalRetirementAge + Math.floor(delayMonths / 12) + (delayMonths % 12 ? 1 : 0);
  let ageMonthStr = delayMonths % 12 == 0 ? '' : delayMonths % 12 + '个月'

  return {
    retirementAge: `${retirementAge}岁${ageMonthStr}`,
    retirementTime: `${newRetirementYear}-${String(newRetirementMonth + 1).padStart(2, '0')}`,
    delayMonths: delayMonths
  };
}

// 示例调用
console.log('男职工退休年龄计算--->')
for (let y = 1964; y <= 1977; y++) {
  for (let m = 1; m <= 12; m++) {
    let r = calculateMaleRetirement(y, m)
    console.log(y + '-' + m, r.retirementAge, r.retirementTime, r.delayMonths)
  }
}
console.log('原法定退休年龄为 55 周岁的女职工退休年龄计算--->')
for (let y = 1969; y <= 1982; y++) {
  for (let m = 1; m <= 12; m++) {
    let r = calculateFemaleRetirement55(y, m)
    console.log(y + '-' + m, r.retirementAge, r.retirementTime, r.delayMonths)
  }
}

console.log('原法定退休年龄为 50 周岁的女职工退休年龄计算--->')
for (let y = 1974; y <= 1985; y++) {
  for (let m = 1; m <= 12; m++) {
    let r = calculateFemaleRetirement50(y, m)
    console.log(y + '-' + m, r.retirementAge, r.retirementTime, r.delayMonths)
  }
}