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
// Returns { issues, missing }

export function evaluateCompatibility({ configItems, groupById, rules, categorySlugById }) {
  const issues = [];
  const missing = [];

  const bySlot = new Map(configItems.map(ci => [ci.slotSlug, ci]));
  const groupSlugById = new Map([...groupById.entries()].map(([id, g]) => [id, g.slug]));
  const missingDataKeys = new Set();

  function pushMissingData(ruleName, slots) {
    if (!missingDataKeys.has(ruleName)) {
      missingDataKeys.add(ruleName);
      issues.push({ code: 'MISSING_DATA', level: 'info', slots, message: `Chưa đủ dữ liệu để kiểm tra: ${ruleName}` });
    }
  }

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
        issues.push({
          code: rule.ruleType, level: severity, slots,
          message: `${rule.errorMessage} (${valsA.numbers[0]} > ${valsB.numbers[0]})`,
        });
      }
    } else if (rule.ruleType === RULE_TYPES.ATTR_MATCH) {
      const setA = sameSlug ? valsA.ids : valsA.values;
      const setB = sameSlug ? valsB.ids : valsB.values;
      if (setA.size === 0 || setB.size === 0) { pushMissingData(rule.name, slots); continue; }
      if (!setsIntersect(setA, setB)) {
        issues.push({ code: rule.ruleType, level: severity, slots, message: rule.errorMessage });
      }
    } else if (rule.ruleType === RULE_TYPES.ATTR_SUBSET) {
      const setA = sameSlug ? valsA.ids : valsA.values;
      const setB = sameSlug ? valsB.ids : valsB.values;
      if (setA.size === 0 || setB.size === 0) { pushMissingData(rule.name, slots); continue; }
      if (!setASubsetOfB(setA, setB)) {
        issues.push({ code: rule.ruleType, level: severity, slots, message: rule.errorMessage });
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
        issues.push({
          code: 'RAM_SLOTS', level: 'error',
          slots: [SLOT.RAM, SLOT.MAINBOARD],
          message: `Số module RAM (${totalModules}) vượt số khe RAM của Bo mạch chủ (${maxSlots})`,
        });
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
          issues.push({
            code: 'M2_SLOTS', level: 'error',
            slots: [SLOT.SSD, SLOT.MAINBOARD],
            message: `Số SSD M.2 (${totalM2}) vượt số khe M.2 của Bo mạch chủ (${maxM2})`,
          });
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
        issues.push({
          code: 'PSU_WATTAGE', level: 'warning',
          slots: [SLOT.PSU, SLOT.CPU],
          message: `Nguồn ${psuWattage.numbers[0]}W có thể không đủ. Khuyến nghị ít nhất ${recommended}W.`,
        });
      }
    }
  }

  // OUT_OF_STOCK
  for (const ci of configItems) {
    if (ci.product.stockQuantity < ci.quantity) {
      issues.push({
        code: 'OUT_OF_STOCK', level: 'error',
        slots: [ci.slotSlug],
        message: `${ci.product.name} không đủ hàng (tồn kho: ${ci.product.stockQuantity}, cần: ${ci.quantity})`,
      });
    }
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

  return { issues, missing };
}
