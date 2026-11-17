import {
  RULE_TYPES,
  PSU_HEADROOM_WATTS,
  PSU_FACTOR,
  SLOT,
  ATTR,
  CAT_SSD_M2,
} from '../config/buildPc.config.js';

// ── Attribute extraction ───────────────────────────────────────────────────

function getAttrValSet(product, attrSlug) {
  const pavs = product.attributeValues.filter(p => p.attribute?.slug === attrSlug);
  if (pavs.length === 0) return { ids: new Set(), values: new Set(), numbers: [] };

  const type = pavs[0].attribute?.type;
  if (type === 'NUMBER') {
    const numbers = pavs
      .map(p => (p.valueNumber != null ? Number(p.valueNumber) : null))
      .filter(n => n !== null);
    return { ids: new Set(), values: new Set(), numbers };
  }

  const ids = new Set();
  const values = new Set();
  for (const p of pavs) {
    if (p.attributeValueId != null) ids.add(p.attributeValueId);
    if (p.attributeValue?.value) values.add(p.attributeValue.value.trim().toLowerCase());
  }
  return { ids, values, numbers: [] };
}

function setsIntersect(setA, setB) {
  for (const v of setA) if (setB.has(v)) return true;
  return false;
}

function setASubsetOfB(setA, setB) {
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

// ── Pure evaluation ────────────────────────────────────────────────────────
//
// configItems: [{ slotSlug, product (with attributeValues), quantity }]
// groupById:   Map<groupId, BuildPcGroup>  (slug + isRequired + name)
// rules:       CompatibilityRule[] (from DB)
// categorySlugById: Map<categoryId, categorySlug>
//
// Returns { issues, missing, checks }
//   issues: chỉ các vấn đề (lỗi, cảnh báo, thiếu dữ liệu)
//   checks: MỌI luật đã kiểm, mỗi luật một dòng { code, name, status, slots, message }
//           status: 'pass' (đạt) | 'fail' (lỗi) | 'warning' (cảnh báo) | 'skip' (thiếu dữ liệu để kiểm tra)
//           message của luật đạt nêu giá trị cụ thể đã đối chiếu (ví dụ "Bộ vi xử lý: LGA1700 · Bo mạch chủ: LGA1700").

export function evaluateCompatibility({ configItems, groupById, rules, categorySlugById }) {
  const issues = [];
  const missing = [];
  const checks = [];

  const bySlot = new Map(configItems.map(ci => [ci.slotSlug, ci]));
  const groupSlugById = new Map([...groupById.entries()].map(([id, g]) => [id, g.slug]));
  const groupNameBySlug = new Map([...groupById.values()].map(g => [g.slug, g.name]));
  const nameOf = slug => groupNameBySlug.get(slug) ?? slug;
  const showSet = set => [...set].map(v => String(v).toUpperCase()).join(' / ');
  const missingDataKeys = new Set();

  function pushMissingData(ruleName, slots) {
    if (!missingDataKeys.has(ruleName)) {
      missingDataKeys.add(ruleName);
      issues.push({ code: 'MISSING_DATA', level: 'info', slots, message: `Chưa đủ dữ liệu để kiểm tra: ${ruleName}` });
      checks.push({ code: 'MISSING_DATA', name: ruleName, status: 'skip', slots, message: 'Chưa đủ dữ liệu thông số để kiểm tra luật này.' });
    }
  }
  const pass = (code, name, slots, message) => checks.push({ code, name, status: 'pass', slots, message });
  const failed = (code, name, level, slots, message) => checks.push({ code, name, status: level === 'warning' ? 'warning' : 'fail', slots, message });

  // ── DB rules ──────────────────────────────────────────────────────────────
  for (const rule of rules) {
    const slotSlugA = groupSlugById.get(rule.groupAId);
    const slotSlugB = groupSlugById.get(rule.groupBId);
    if (!slotSlugA || !slotSlugB) continue;

    const itemA = bySlot.get(slotSlugA);
    const itemB = bySlot.get(slotSlugB);
    if (!itemA || !itemB) continue;

    const severity = rule.config?.severity ?? 'error';
    const sameSlug = rule.attributeASlug === rule.attributeBSlug;
    const valsA = getAttrValSet(itemA.product, rule.attributeASlug);
    const valsB = getAttrValSet(itemB.product, rule.attributeBSlug);
    const slots = [slotSlugA, slotSlugB];

    if (rule.ruleType === RULE_TYPES.ATTR_LTE) {
      if (valsA.numbers.length === 0 || valsB.numbers.length === 0) {
        pushMissingData(rule.name, slots);
        continue;
      }
      if (valsA.numbers[0] > valsB.numbers[0]) {
        const message = `${rule.errorMessage} (${valsA.numbers[0]} > ${valsB.numbers[0]})`;
        issues.push({ code: rule.ruleType, level: severity, slots, message });
        failed(rule.ruleType, rule.name, severity, slots, message);
      } else {
        pass(rule.ruleType, rule.name, slots, `${nameOf(slotSlugA)}: ${valsA.numbers[0]} ≤ ${nameOf(slotSlugB)}: ${valsB.numbers[0]}`);
      }
    } else if (rule.ruleType === RULE_TYPES.ATTR_MATCH) {
      const setA = sameSlug ? valsA.ids : valsA.values;
      const setB = sameSlug ? valsB.ids : valsB.values;
      if (setA.size === 0 || setB.size === 0) { pushMissingData(rule.name, slots); continue; }
      if (!setsIntersect(setA, setB)) {
        issues.push({ code: rule.ruleType, level: severity, slots, message: rule.errorMessage });
        failed(rule.ruleType, rule.name, severity, slots, rule.errorMessage);
      } else {
        pass(rule.ruleType, rule.name, slots, `${nameOf(slotSlugA)}: ${showSet(valsA.values)} · ${nameOf(slotSlugB)}: ${showSet(valsB.values)}`);
      }
    } else if (rule.ruleType === RULE_TYPES.ATTR_SUBSET) {
      const setA = sameSlug ? valsA.ids : valsA.values;
      const setB = sameSlug ? valsB.ids : valsB.values;
      if (setA.size === 0 || setB.size === 0) { pushMissingData(rule.name, slots); continue; }
      if (!setASubsetOfB(setA, setB)) {
        issues.push({ code: rule.ruleType, level: severity, slots, message: rule.errorMessage });
        failed(rule.ruleType, rule.name, severity, slots, rule.errorMessage);
      } else {
        pass(rule.ruleType, rule.name, slots, `${nameOf(slotSlugA)}: ${showSet(valsA.values)} · ${nameOf(slotSlugB)}: ${showSet(valsB.values)}`);
      }
    }
  }

  // ── Code rules ────────────────────────────────────────────────────────────

  const ramItem  = bySlot.get(SLOT.RAM);
  const mainItem = bySlot.get(SLOT.MAINBOARD);
  const cpuItem  = bySlot.get(SLOT.CPU);
  const psuItem  = bySlot.get(SLOT.PSU);
  const ssdItem  = bySlot.get(SLOT.SSD);
  const vgaItem  = bySlot.get(SLOT.VGA) ?? bySlot.get(SLOT.VGA_LIKE_NEW);

  // RAM_SLOTS
  if (ramItem && mainItem) {
    const ramModules = getAttrValSet(ramItem.product, ATTR.RAM_MODULES);
    const soKheRam  = getAttrValSet(mainItem.product, ATTR.SO_KHE_RAM);
    if (ramModules.numbers.length === 0 || soKheRam.numbers.length === 0) {
      pushMissingData('khe RAM', [SLOT.RAM, SLOT.MAINBOARD]);
    } else {
      const totalModules = ramModules.numbers[0] * ramItem.quantity;
      const maxSlots     = soKheRam.numbers[0];
      if (totalModules > maxSlots) {
        const message = `Số module RAM (${totalModules}) vượt số khe RAM của Bo mạch chủ (${maxSlots})`;
        issues.push({ code: 'RAM_SLOTS', level: 'error', slots: [SLOT.RAM, SLOT.MAINBOARD], message });
        failed('RAM_SLOTS', 'Số thanh RAM và khe cắm', 'error', [SLOT.RAM, SLOT.MAINBOARD], message);
      } else {
        pass('RAM_SLOTS', 'Số thanh RAM và khe cắm', [SLOT.RAM, SLOT.MAINBOARD], `${totalModules} thanh RAM trên ${maxSlots} khe.`);
      }
    }
  }

  // M2_SLOTS
  if (ssdItem && mainItem) {
    const catSlug = categorySlugById.get(ssdItem.product.categoryId);
    if (catSlug === CAT_SSD_M2) {
      const soKheM2 = getAttrValSet(mainItem.product, ATTR.SO_KHE_M2);
      if (soKheM2.numbers.length === 0) {
        pushMissingData('khe M.2', [SLOT.SSD, SLOT.MAINBOARD]);
      } else {
        const totalM2 = ssdItem.quantity;
        const maxM2   = soKheM2.numbers[0];
        if (totalM2 > maxM2) {
          const message = `Số SSD M.2 (${totalM2}) vượt số khe M.2 của Bo mạch chủ (${maxM2})`;
          issues.push({ code: 'M2_SLOTS', level: 'error', slots: [SLOT.SSD, SLOT.MAINBOARD], message });
          failed('M2_SLOTS', 'Khe M.2 cho SSD', 'error', [SLOT.SSD, SLOT.MAINBOARD], message);
        } else {
          pass('M2_SLOTS', 'Khe M.2 cho SSD', [SLOT.SSD, SLOT.MAINBOARD], `${totalM2} SSD M.2 trên ${maxM2} khe.`);
        }
      }
    }
  }

  // PSU_WATTAGE
  if (psuItem && cpuItem) {
    const psuWattage = getAttrValSet(psuItem.product, ATTR.PSU_WATTAGE);
    const cpuTdp     = getAttrValSet(cpuItem.product, ATTR.TDP);
    if (psuWattage.numbers.length === 0 || cpuTdp.numbers.length === 0) {
      pushMissingData('công suất nguồn', [SLOT.PSU, SLOT.CPU]);
    } else {
      const vgaTdp     = vgaItem ? getAttrValSet(vgaItem.product, ATTR.TDP) : null;
      const vgaWatts   = (vgaTdp && vgaTdp.numbers.length > 0) ? vgaTdp.numbers[0] : 0;
      const recommended = Math.ceil((cpuTdp.numbers[0] + vgaWatts + PSU_HEADROOM_WATTS) * PSU_FACTOR);
      if (psuWattage.numbers[0] < recommended) {
        const message = `Nguồn ${psuWattage.numbers[0]}W có thể không đủ. Khuyến nghị ít nhất ${recommended}W.`;
        issues.push({ code: 'PSU_WATTAGE', level: 'warning', slots: [SLOT.PSU, SLOT.CPU], message });
        failed('PSU_WATTAGE', 'Công suất nguồn', 'warning', [SLOT.PSU, SLOT.CPU], message);
      } else {
        const estimated = cpuTdp.numbers[0] + vgaWatts;
        pass('PSU_WATTAGE', 'Công suất nguồn', [SLOT.PSU, SLOT.CPU], `Nguồn ${psuWattage.numbers[0]}W đủ cho mức ước tính ${estimated}W (khuyến nghị từ ${recommended}W).`);
      }
    }
  }

  // OUT_OF_STOCK
  let outOfStock = 0;
  for (const ci of configItems) {
    if (ci.product.stockQuantity < ci.quantity) {
      outOfStock += 1;
      issues.push({
        code: 'OUT_OF_STOCK', level: 'error',
        slots: [ci.slotSlug],
        message: `${ci.product.name} không đủ hàng (tồn kho: ${ci.product.stockQuantity}, cần: ${ci.quantity})`,
      });
    }
  }
  if (configItems.length > 0) {
    if (outOfStock === 0) pass('OUT_OF_STOCK', 'Tồn kho', configItems.map(ci => ci.slotSlug), `Cả ${configItems.length} linh kiện đều còn hàng.`);
    else failed('OUT_OF_STOCK', 'Tồn kho', 'error', configItems.map(ci => ci.slotSlug), `${outOfStock} linh kiện không đủ hàng.`);
  }

  // Missing storage: any items selected but no HDD and no SSD
  if (configItems.length > 0 && !bySlot.has(SLOT.HDD) && !bySlot.has(SLOT.SSD)) {
    missing.push({ slots: [SLOT.HDD, SLOT.SSD], message: 'Cần ít nhất một ổ cứng (HDD hoặc SSD)' });
  }

  // Missing required slots
  for (const group of groupById.values()) {
    if (group.isRequired && !bySlot.has(group.slug)) {
      missing.push({ slots: [group.slug], message: `Còn thiếu: ${group.name}` });
    }
  }

  return { issues, missing, checks };
}
