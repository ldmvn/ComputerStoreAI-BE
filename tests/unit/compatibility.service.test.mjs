import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompatibility } from '../../src/services/compatibility.service.js';
import { SLOT, ATTR, RULE_TYPES, PSU_HEADROOM_WATTS, PSU_FACTOR, CAT_SSD_M2 } from '../../src/config/buildPc.config.js';

// ---------------------------------------------------------------------------
// Helpers — tạo product stub cho test
// ---------------------------------------------------------------------------

function numAttr(slug, number) {
  return { attribute: { slug, type: 'NUMBER' }, attributeValue: null, attributeValueId: null, valueNumber: number };
}

function textAttr(slug, value, id = 1) {
  return { attribute: { slug, type: 'TEXT' }, attributeValue: { value }, attributeValueId: id, valueNumber: null };
}

function makeProduct({ name = 'Product', stockQuantity = 10, categoryId = 1, attrs = [] } = {}) {
  return { name, stockQuantity, categoryId, attributeValues: attrs };
}

function makeItem(slotSlug, product, quantity = 1) {
  return { slotSlug, product, quantity };
}

// ---------------------------------------------------------------------------
// OUT_OF_STOCK
// ---------------------------------------------------------------------------

test('OUT_OF_STOCK: báo lỗi khi tồn kho < số lượng yêu cầu', () => {
  const cpu = makeProduct({ name: 'CPU X', stockQuantity: 1 });
  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 2)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'OUT_OF_STOCK');
  assert.equal(issues[0].level, 'error');
  assert.ok(issues[0].message.includes('CPU X'));
});

test('OUT_OF_STOCK: không báo khi tồn kho đủ', () => {
  const cpu = makeProduct({ stockQuantity: 5 });
  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 5)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === 'OUT_OF_STOCK').length, 0);
});

// ---------------------------------------------------------------------------
// RAM_SLOTS (code rule)
// ---------------------------------------------------------------------------

test('RAM_SLOTS: báo lỗi khi số module RAM vượt số khe', () => {
  const ram  = makeProduct({ attrs: [numAttr(ATTR.RAM_MODULES, 2)] }); // 2 thanh
  const main = makeProduct({ attrs: [numAttr(ATTR.SO_KHE_RAM, 1)] }); // 1 khe

  const groups = new Map([
    [1, { slug: SLOT.RAM,       isRequired: false, name: 'RAM' }],
    [2, { slug: SLOT.MAINBOARD, isRequired: false, name: 'Mainboard' }],
  ]);

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.RAM, ram, 1), makeItem(SLOT.MAINBOARD, main, 1)],
    groupById: groups,
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === 'RAM_SLOTS').length, 1);
});

test('RAM_SLOTS: không báo khi số module RAM <= số khe', () => {
  const ram  = makeProduct({ attrs: [numAttr(ATTR.RAM_MODULES, 2)] }); // 2 thanh
  const main = makeProduct({ attrs: [numAttr(ATTR.SO_KHE_RAM, 4)] }); // 4 khe

  const groups = new Map([
    [1, { slug: SLOT.RAM,       isRequired: false, name: 'RAM' }],
    [2, { slug: SLOT.MAINBOARD, isRequired: false, name: 'Mainboard' }],
  ]);

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.RAM, ram, 1), makeItem(SLOT.MAINBOARD, main, 1)],
    groupById: groups,
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === 'RAM_SLOTS').length, 0);
});

// ---------------------------------------------------------------------------
// PSU_WATTAGE (code rule)
// ---------------------------------------------------------------------------

test('PSU_WATTAGE: cảnh báo khi nguồn không đủ công suất', () => {
  // CPU TDP=65W, VGA TDP=150W → recommended = ceil((65+150+100)*1.2) = ceil(378) = 378W
  const cpu = makeProduct({ attrs: [numAttr(ATTR.TDP, 65)] });
  const vga = makeProduct({ attrs: [numAttr(ATTR.TDP, 150)] });
  const psu = makeProduct({ attrs: [numAttr(ATTR.PSU_WATTAGE, 300)] }); // 300W < 378W

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.VGA, vga, 1), makeItem(SLOT.PSU, psu, 1)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === 'PSU_WATTAGE').length, 1);
  assert.equal(issues.find(i => i.code === 'PSU_WATTAGE').level, 'warning');
});

test('PSU_WATTAGE: không cảnh báo khi nguồn đủ', () => {
  const cpu = makeProduct({ attrs: [numAttr(ATTR.TDP, 65)] });
  const psu = makeProduct({ attrs: [numAttr(ATTR.PSU_WATTAGE, 500)] }); // 500W > ceil((65+100)*1.2)=198W

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.PSU, psu, 1)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === 'PSU_WATTAGE').length, 0);
});

// ---------------------------------------------------------------------------
// M2_SLOTS (code rule)
// ---------------------------------------------------------------------------

test('M2_SLOTS: báo lỗi khi SSD M.2 vượt số khe M.2', () => {
  const ssd  = makeProduct({ categoryId: 99, attrs: [] });
  const main = makeProduct({ attrs: [numAttr(ATTR.SO_KHE_M2, 1)] });

  const catMap = new Map([[99, CAT_SSD_M2]]);

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.SSD, ssd, 2), makeItem(SLOT.MAINBOARD, main, 1)],
    groupById: new Map(),
    rules: [],
    categorySlugById: catMap,
  });
  assert.equal(issues.filter(i => i.code === 'M2_SLOTS').length, 1);
});

// ---------------------------------------------------------------------------
// Missing storage
// ---------------------------------------------------------------------------

test('missing: cảnh báo thiếu ổ cứng khi không có SSD và HDD', () => {
  const cpu = makeProduct();
  const { missing } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.ok(missing.some(m => m.slots.includes(SLOT.SSD) || m.slots.includes(SLOT.HDD)));
});

test('missing: không cảnh báo khi đã có SSD', () => {
  const cpu = makeProduct();
  const ssd = makeProduct();
  const { missing } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.SSD, ssd, 1)],
    groupById: new Map(),
    rules: [],
    categorySlugById: new Map(),
  });
  assert.equal(missing.filter(m => m.slots.includes(SLOT.SSD)).length, 0);
});

// ---------------------------------------------------------------------------
// DB rule: ATTR_MATCH
// ---------------------------------------------------------------------------

test('ATTR_MATCH rule: báo lỗi khi attribute không khớp', () => {
  const socket = 'socket';
  const cpu  = makeProduct({ attrs: [textAttr(socket, 'am5', 1)] });
  const main = makeProduct({ attrs: [textAttr(socket, 'lga1700', 2)] });

  const groups = new Map([
    [10, { slug: SLOT.CPU,       isRequired: false, name: 'CPU' }],
    [20, { slug: SLOT.MAINBOARD, isRequired: false, name: 'Mainboard' }],
  ]);

  const rule = {
    groupAId: 10, groupBId: 20,
    ruleType: RULE_TYPES.ATTR_MATCH,
    attributeASlug: socket, attributeBSlug: socket,
    errorMessage: 'Socket không khớp',
    config: { severity: 'error' },
    name: 'socket-match',
  };

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.MAINBOARD, main, 1)],
    groupById: groups,
    rules: [rule],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === RULE_TYPES.ATTR_MATCH).length, 1);
  assert.equal(issues.find(i => i.code === RULE_TYPES.ATTR_MATCH).message, 'Socket không khớp');
});

test('ATTR_MATCH rule: không báo lỗi khi attribute khớp', () => {
  const socket = 'socket';
  const cpu  = makeProduct({ attrs: [textAttr(socket, 'am5', 5)] });
  const main = makeProduct({ attrs: [textAttr(socket, 'am5', 5)] }); // cùng attributeValueId

  const groups = new Map([
    [10, { slug: SLOT.CPU,       isRequired: false, name: 'CPU' }],
    [20, { slug: SLOT.MAINBOARD, isRequired: false, name: 'Mainboard' }],
  ]);

  const rule = {
    groupAId: 10, groupBId: 20,
    ruleType: RULE_TYPES.ATTR_MATCH,
    attributeASlug: socket, attributeBSlug: socket,
    errorMessage: 'Socket không khớp',
    config: { severity: 'error' },
    name: 'socket-match',
  };

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.MAINBOARD, main, 1)],
    groupById: groups,
    rules: [rule],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === RULE_TYPES.ATTR_MATCH).length, 0);
});

// ---------------------------------------------------------------------------
// ATTR_LTE rule
// ---------------------------------------------------------------------------

test('ATTR_LTE rule: báo lỗi khi giá trị A > B', () => {
  const slug = 'tdp';
  const cpu = makeProduct({ attrs: [numAttr(slug, 200)] });
  const psu = makeProduct({ attrs: [numAttr(slug, 100)] });

  const groups = new Map([
    [1, { slug: SLOT.CPU, isRequired: false, name: 'CPU' }],
    [2, { slug: SLOT.PSU, isRequired: false, name: 'PSU' }],
  ]);

  const rule = {
    groupAId: 1, groupBId: 2,
    ruleType: RULE_TYPES.ATTR_LTE,
    attributeASlug: slug, attributeBSlug: slug,
    errorMessage: 'CPU TDP vượt PSU',
    config: { severity: 'error' },
    name: 'tdp-check',
  };

  const { issues } = evaluateCompatibility({
    configItems: [makeItem(SLOT.CPU, cpu, 1), makeItem(SLOT.PSU, psu, 1)],
    groupById: groups,
    rules: [rule],
    categorySlugById: new Map(),
  });
  assert.equal(issues.filter(i => i.code === RULE_TYPES.ATTR_LTE).length, 1);
});
