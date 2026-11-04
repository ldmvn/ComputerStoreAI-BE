// Seed script: Build PC — categories, attributes, groups, compatibility rules.
// Safe to run multiple times (idempotent, additive only).
// Run: node src/scripts/seedBuildPc.js [--dry-run] [--cleanup] [--force]
//
// Compatibility rules handled by application code (NOT seeded):
//   11. sum(quantity × ram-modules per slot) ≤ so-khe-ram (mainboard, id=35)
//   12. count(SSD M.2 slots chosen) ≤ so-khe-m-2 (mainboard, id=38)
//   13. psu-wattage ≥ (tdp CPU + tdp VGA + 100) × 1.2
//   14. phải có ít nhất một HDD hoặc SSD

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLEANUP  = args.includes('--cleanup');
const FORCE    = args.includes('--force');

if (process.env.NODE_ENV === 'production' && !FORCE) {
  console.error('ERROR: Từ chối chạy trong môi trường production. Thêm --force nếu thực sự cần.');
  process.exit(1);
}

const prisma = new PrismaClient();
const stats  = { created: 0, skipped: 0, updated: 0, deleted: 0 };
let   fakeId = -1;
function nextFakeId() { return fakeId--; }

function logOp(action, type, identifier, extra = '') {
  const tag = `[${action}]`.padEnd(10);
  const t   = type.padEnd(28);
  console.log(`${tag} ${t} ${identifier}${extra ? '  ' + extra : ''}`);
  if      (action === 'CREATE') stats.created++;
  else if (action === 'SKIP')   stats.skipped++;
  else if (action === 'UPDATE') stats.updated++;
  else if (action === 'DELETE') stats.deleted++;
}

// ── Data definitions ──────────────────────────────────────────────────────────

// 15 new leaf categories
// ban-phim-chuot: root-level (parentId=null), purposely NOT a child of ban-phim (id=22)
// to prevent the keyboard slot category search from inheriting keyboard-mouse combos.
const NEW_CATEGORIES = [
  { name: 'Card màn hình',          slug: 'vga',                  parentId: 17,   sortOrder: 10 },
  { name: 'Card màn hình Like New', slug: 'vga-like-new',         parentId: 17,   sortOrder: 11 },
  { name: 'Nguồn máy tính',         slug: 'nguon',                parentId: 18,   sortOrder: 10 },
  { name: 'Vỏ case máy tính',       slug: 'vo-case',              parentId: 18,   sortOrder: 11 },
  { name: 'Tản nhiệt CPU (Air)',     slug: 'tan-nhiet-cpu-air',    parentId: 18,   sortOrder: 12 },
  { name: 'Tản nhiệt CPU (AIO)',     slug: 'tan-nhiet-cpu-aio',    parentId: 18,   sortOrder: 13 },
  { name: 'Tản nhiệt nước Custom',   slug: 'tan-nhiet-cpu-custom', parentId: 18,   sortOrder: 14 },
  { name: 'Quạt case',              slug: 'quat-case',            parentId: 18,   sortOrder: 15 },
  { name: 'Ổ cứng SSD M.2',         slug: 'ssd-m2',               parentId: 19,   sortOrder: 10 },
  { name: 'Ổ cứng SSD 2.5"',        slug: 'ssd-25',               parentId: 19,   sortOrder: 11 },
  { name: 'Ổ cứng HDD',             slug: 'hdd',                  parentId: 19,   sortOrder: 12 },
  { name: 'Loa máy tính',           slug: 'loa',                  parentId: 20,   sortOrder: 10 },
  { name: 'Bộ bàn phím + chuột',   slug: 'ban-phim-chuot',       parentId: null, sortOrder: 30 },
  { name: 'Chuột máy tính',         slug: 'chuot',                parentId: 23,   sortOrder: 10 },
  { name: 'Ghế Gaming',             slug: 'ghe-gaming',           parentId: 25,   sortOrder: 10 },
];

// Existing attributes to update: type → MULTI_SELECT (idempotent)
const REUSE_TYPE_UPDATES = [
  { id: 32, slug: 'socket-cpu',           fromType: 'SELECT', toType: 'MULTI_SELECT' },
  { id: 34, slug: 'kich-thuoc-mainboard', fromType: 'SELECT', toType: 'MULTI_SELECT' },
];

// Existing attributes to verify usedInBuildPC (log SKIP if already true, UPDATE if false)
const REUSE_BUILD_PC = [
  { id: 29, slug: 'loai-ram' },
  { id: 32, slug: 'socket-cpu' },
  { id: 34, slug: 'kich-thuoc-mainboard' },
];

// 8 new attributes
// Reused: loai-ram(29), socket-cpu(32), kich-thuoc-mainboard(34), so-khe-ram(35), so-khe-m-2(38)
const NEW_ATTRIBUTES = [
  { name: 'Chiều dài VGA',               slug: 'vga-length',            type: 'NUMBER',       unit: 'mm',  usedInBuildPC: false, sortOrder: 90 },
  { name: 'Chiều dài VGA tối đa (Case)', slug: 'case-max-vga-length',   type: 'NUMBER',       unit: 'mm',  usedInBuildPC: false, sortOrder: 91 },
  { name: 'TDP',                          slug: 'tdp',                   type: 'NUMBER',       unit: 'W',   usedInBuildPC: false, sortOrder: 92 },
  { name: 'Công suất nguồn',             slug: 'psu-wattage',           type: 'NUMBER',       unit: 'W',   usedInBuildPC: false, sortOrder: 93 },
  { name: 'Chiều cao tản nhiệt',         slug: 'cooler-height',         type: 'NUMBER',       unit: 'mm',  usedInBuildPC: false, sortOrder: 94 },
  { name: 'Chiều cao tản nhiệt tối đa',  slug: 'case-max-cooler-height',type: 'NUMBER',       unit: 'mm',  usedInBuildPC: false, sortOrder: 95 },
  { name: 'Số module RAM (mỗi thanh)',   slug: 'ram-modules',           type: 'NUMBER',       unit: null,  usedInBuildPC: false, sortOrder: 96 },
  { name: 'Kích thước két nước AIO',    slug: 'radiator-size',         type: 'MULTI_SELECT', unit: 'mm',  usedInBuildPC: true,  sortOrder: 97 },
];

// AttributeValues for new MULTI_SELECT attributes
const ATTR_VALUES = {
  'radiator-size': ['120', '240', '280', '360', '420', '140'],
};

// 20 BuildPcGroups (sortOrder 1–20)
// [name, slug, categorySlugs[], isRequired, minCount, maxCount, badgeText, exclusiveGroup, sortOrder]
const GROUPS = [
  ['Bộ vi xử lý',                'cpu',                 ['cpu'],                     true,  1, 1, null,           null,          1],
  ['Bo mạch chủ',                'mainboard',           ['main'],                    true,  1, 1, null,           null,          2],
  ['RAM',                        'ram',                 ['ram'],                     true,  1, 4, null,           null,          3],
  ['Ổ cứng HDD',                 'hdd',                 ['hdd'],                     false, 0, 4, null,           null,          4],
  ['Ổ cứng SSD',                 'ssd',                 ['ssd-m2', 'ssd-25'],        false, 0, 4, 'GIÁ CỰC SỐC', null,          5],
  ['Card màn hình',              'vga',                 ['vga'],                     false, 0, 1, 'GIÁ CỰC SỐC', 'vga-slot',    6],
  ['Card màn hình Like New',     'vga-like-new',        ['vga-like-new'],            false, 0, 1, null,           'vga-slot',    7],
  ['Nguồn',                      'psu',                 ['nguon'],                   true,  1, 1, null,           null,          8],
  ['Vỏ Case',                    'case',                ['vo-case'],                 true,  1, 1, null,           null,          9],
  ['Màn hình',                   'monitor',             ['man-hinh'],                false, 0, 3, null,           null,         10],
  ['Bộ bàn phím, chuột',         'keyboard-mouse-combo',['ban-phim-chuot'],          false, 0, 1, null,           null,         11],
  ['Bàn phím',                   'keyboard',            ['ban-phim'],                false, 0, 1, null,           null,         12],
  ['Chuột',                      'mouse',               ['chuot'],                   false, 0, 1, null,           null,         13],
  ['Tai nghe',                   'headphone',           ['tai-nghe'],                false, 0, 1, null,           null,         14],
  ['Loa',                        'speaker',             ['loa'],                     false, 0, 1, null,           null,         15],
  ['Ghế Gaming',                 'chair',               ['ghe-gaming'],              false, 0, 1, null,           null,         16],
  ['Quạt làm mát',               'case-fan',            ['quat-case'],               false, 0, 6, null,           null,         17],
  ['Tản nhiệt khí',              'cooler-air',          ['tan-nhiet-cpu-air'],       false, 0, 1, null,           'cooler-slot', 18],
  ['Tản nhiệt nước All in One',  'cooler-aio',          ['tan-nhiet-cpu-aio'],       false, 0, 1, null,           'cooler-slot', 19],
  ['Tản nhiệt nước Custom',      'cooler-custom',       ['tan-nhiet-cpu-custom'],    false, 0, 1, null,           'cooler-slot', 20],
];

const RT = { MATCH: 'ATTR_MATCH', SUBSET: 'ATTR_SUBSET', LTE: 'ATTR_LTE' };

// 10 seeded compatibility rules — using real DB attribute slugs
// [name, ruleType, groupASlug, attrASlug, groupBSlug, attrBSlug, errorMessage, sortOrder]
const RULES = [
  ['CPU phải tương thích socket với Bo mạch chủ',
    RT.MATCH,  'cpu',         'socket-cpu',           'mainboard',    'socket-cpu',
    'Socket CPU không tương thích với Bo mạch chủ',                    1],
  ['RAM phải đúng loại với Bo mạch chủ',
    RT.MATCH,  'ram',         'loai-ram',             'mainboard',    'loai-ram',
    'Loại RAM không tương thích với Bo mạch chủ',                      2],
  ['Bo mạch chủ phải vừa Vỏ Case (form factor)',
    RT.SUBSET, 'mainboard',   'kich-thuoc-mainboard', 'case',         'kich-thuoc-mainboard',
    'Bo mạch chủ không vừa Vỏ Case',                                   3],
  ['VGA phải vừa Vỏ Case (chiều dài)',
    RT.LTE,    'vga',         'vga-length',           'case',         'case-max-vga-length',
    'VGA quá dài so với Vỏ Case',                                      4],
  ['VGA Like New phải vừa Vỏ Case (chiều dài)',
    RT.LTE,    'vga-like-new','vga-length',           'case',         'case-max-vga-length',
    'VGA Like New quá dài so với Vỏ Case',                             5],
  ['Tản nhiệt khí phải vừa Vỏ Case (chiều cao)',
    RT.LTE,    'cooler-air',  'cooler-height',        'case',         'case-max-cooler-height',
    'Tản nhiệt khí quá cao so với Vỏ Case',                            6],
  ['Tản nhiệt khí phải hỗ trợ socket CPU',
    RT.SUBSET, 'cpu',         'socket-cpu',           'cooler-air',   'socket-cpu',
    'Tản nhiệt khí không hỗ trợ socket của CPU',                       7],
  ['Tản nhiệt nước AIO phải hỗ trợ socket CPU',
    RT.SUBSET, 'cpu',         'socket-cpu',           'cooler-aio',   'socket-cpu',
    'Tản nhiệt AIO không hỗ trợ socket của CPU',                       8],
  ['Tản nhiệt nước Custom phải hỗ trợ socket CPU',
    RT.SUBSET, 'cpu',         'socket-cpu',           'cooler-custom','socket-cpu',
    'Tản nhiệt nước Custom không hỗ trợ socket của CPU',               9],
  ['Tản nhiệt nước AIO phải vừa Vỏ Case (kích thước két nước)',
    RT.SUBSET, 'cooler-aio',  'radiator-size',        'case',         'radiator-size',
    'Vỏ Case không hỗ trợ kích thước két nước AIO',                   10],
];

// ── Validation ────────────────────────────────────────────────────────────────

async function validateRefs(existingCatMap, existingAttrMap) {
  const errors      = [];
  const newCatSlugs  = new Set(NEW_CATEGORIES.map(c => c.slug));
  const newAttrSlugs = new Set(NEW_ATTRIBUTES.map(a => a.slug));
  const groupSlugs   = new Set(GROUPS.map(g => g[1]));

  for (const [, slug, catSlugs] of GROUPS) {
    for (const cs of catSlugs) {
      if (!existingCatMap[cs] && !newCatSlugs.has(cs))
        errors.push(`MISSING: Category "${cs}" (used by group "${slug}")`);
    }
  }
  for (const [name, , groupASlug, attrASlug, groupBSlug, attrBSlug] of RULES) {
    if (!existingAttrMap[attrASlug] && !newAttrSlugs.has(attrASlug))
      errors.push(`MISSING: Attribute "${attrASlug}" (rule "${name}" attrA)`);
    if (!existingAttrMap[attrBSlug] && !newAttrSlugs.has(attrBSlug))
      errors.push(`MISSING: Attribute "${attrBSlug}" (rule "${name}" attrB)`);
    if (!groupSlugs.has(groupASlug))
      errors.push(`MISSING: Group "${groupASlug}" (rule "${name}" groupA)`);
    if (!groupSlugs.has(groupBSlug))
      errors.push(`MISSING: Group "${groupBSlug}" (rule "${name}" groupB)`);
  }
  return errors;
}

// ── Record counts ─────────────────────────────────────────────────────────────

async function queryCounts() {
  const [buildPcGroup, buildPcGroupCategory, category, attribute, attributeValue, compatibilityRule, product, productAttributeValue] = await Promise.all([
    prisma.buildPcGroup.count(),
    prisma.buildPcGroupCategory.count(),
    prisma.category.count(),
    prisma.attribute.count(),
    prisma.attributeValue.count(),
    prisma.compatibilityRule.count(),
    prisma.product.count({ where: { isDeleted: false } }),
    prisma.productAttributeValue.count(),
  ]);
  return { buildPcGroup, buildPcGroupCategory, category, attribute, attributeValue, compatibilityRule, product, productAttributeValue };
}

// ── Seed phases ───────────────────────────────────────────────────────────────

async function seedCategories(existingCatMap) {
  console.log('\n─── Categories (15 mới) ────────────────────────────────────────');
  for (const def of NEW_CATEGORIES) {
    if (existingCatMap[def.slug]) {
      logOp('SKIP', 'Category', def.slug, `id=${existingCatMap[def.slug].id}`);
    } else {
      logOp('CREATE', 'Category', def.slug, `"${def.name}"  parent=${def.parentId ?? 'root'}`);
      if (!DRY_RUN) {
        const c = await prisma.category.create({
          data: { name: def.name, slug: def.slug, parentId: def.parentId, sortOrder: def.sortOrder, isActive: true },
        });
        existingCatMap[def.slug] = { ...c, parentId: def.parentId };
      } else {
        existingCatMap[def.slug] = { id: nextFakeId(), slug: def.slug, parentId: def.parentId, _virtual: true };
      }
    }
  }
}

async function seedAttributes(existingAttrMap) {
  console.log('\n─── Attribute type updates (SELECT → MULTI_SELECT, idempotent) ──');
  for (const upd of REUSE_TYPE_UPDATES) {
    const current = existingAttrMap[upd.slug];
    if (!current) { console.warn(`  WARN: ${upd.slug} not found`); continue; }
    if (current.type === upd.toType) {
      logOp('SKIP', 'Attribute (type)', upd.slug, `already ${upd.toType}`);
    } else {
      logOp('UPDATE', 'Attribute (type)', upd.slug, `${current.type} → ${upd.toType}  id=${upd.id}`);
      if (!DRY_RUN) {
        await prisma.attribute.update({ where: { id: upd.id }, data: { type: upd.toType } });
        existingAttrMap[upd.slug] = { ...current, type: upd.toType };
      } else {
        existingAttrMap[upd.slug] = { ...current, type: upd.toType };
      }
    }
  }

  console.log('\n─── Attribute usedInBuildPC check ──────────────────────────────');
  for (const r of REUSE_BUILD_PC) {
    const current = existingAttrMap[r.slug];
    if (!current) { console.warn(`  WARN: ${r.slug} not found`); continue; }
    if (current.usedInBuildPC) {
      logOp('SKIP', 'Attribute (usedInBuildPC)', r.slug, `already true  id=${r.id}`);
    } else {
      logOp('UPDATE', 'Attribute (usedInBuildPC)', r.slug, `false → true  id=${r.id}`);
      if (!DRY_RUN) await prisma.attribute.update({ where: { id: r.id }, data: { usedInBuildPC: true } });
    }
  }

  console.log('\n─── Attributes (8 mới) ─────────────────────────────────────────');
  for (const def of NEW_ATTRIBUTES) {
    if (existingAttrMap[def.slug]) {
      logOp('SKIP', 'Attribute', def.slug, `id=${existingAttrMap[def.slug].id}`);
    } else {
      logOp('CREATE', 'Attribute', def.slug,
        `type=${def.type}${def.unit ? ' unit=' + def.unit : ''}  buildPC=${def.usedInBuildPC}`);
      if (!DRY_RUN) {
        const a = await prisma.attribute.create({
          data: { name: def.name, slug: def.slug, type: def.type, unit: def.unit, usedInBuildPC: def.usedInBuildPC, sortOrder: def.sortOrder, isActive: true },
        });
        existingAttrMap[def.slug] = a;
      } else {
        existingAttrMap[def.slug] = { id: nextFakeId(), slug: def.slug, type: def.type, _virtual: true };
      }
    }
  }
}

async function seedAttributeValues(existingAttrMap) {
  console.log('\n─── AttributeValues (radiator-size: 6 values) ───────────────────');
  for (const [attrSlug, values] of Object.entries(ATTR_VALUES)) {
    const attr = existingAttrMap[attrSlug];
    if (!attr) { console.warn(`  WARN: attribute "${attrSlug}" not in map`); continue; }
    for (const [i, val] of values.entries()) {
      if (attr._virtual) {
        logOp('CREATE', 'AttributeValue', `${attrSlug}: ${val}`, `sortOrder=${i}  (virtual attrId=${attr.id})`);
        continue;
      }
      const existing = await prisma.attributeValue.findUnique({
        where: { attributeId_value: { attributeId: attr.id, value: val } },
      });
      if (existing) {
        logOp('SKIP', 'AttributeValue', `${attrSlug}: ${val}`, `id=${existing.id}`);
      } else {
        logOp('CREATE', 'AttributeValue', `${attrSlug}: ${val}`, `sortOrder=${i}`);
        if (!DRY_RUN) {
          await prisma.attributeValue.create({
            data: { attributeId: attr.id, value: val, sortOrder: i, isActive: true },
          });
        }
      }
    }
  }
}

async function seedGroups(existingCatMap) {
  console.log('\n─── BuildPcGroups (20) ──────────────────────────────────────────');
  const groupMap = {};

  for (const [name, slug, catSlugs, isRequired, minCount, maxCount, badgeText, exclusiveGroup, sortOrder] of GROUPS) {
    const existing = await prisma.buildPcGroup.findUnique({ where: { slug } });
    if (existing) {
      logOp('SKIP', 'BuildPcGroup', slug, `id=${existing.id}`);
      groupMap[slug] = existing;
    } else {
      const flags = [
        isRequired ? 'required' : 'optional',
        `max=${maxCount}`,
        badgeText      ? `badge="${badgeText}"` : '',
        exclusiveGroup ? `excl=${exclusiveGroup}` : '',
      ].filter(Boolean).join(' ');
      logOp('CREATE', 'BuildPcGroup', slug, `"${name}"  ${flags}`);
      if (!DRY_RUN) {
        const g = await prisma.buildPcGroup.create({
          data: { name, slug, isRequired, minCount, maxCount, badgeText, exclusiveGroup, sortOrder, isActive: true },
        });
        groupMap[slug] = g;
      } else {
        groupMap[slug] = { id: nextFakeId(), slug, _virtual: true };
      }
    }

    const group = groupMap[slug];
    for (const catSlug of catSlugs) {
      const cat   = existingCatMap[catSlug];
      const catId = cat?.id;
      const grpId = group?.id;
      if (!catId || !grpId || cat?._virtual || group?._virtual) {
        logOp('CREATE', 'GroupCategory', `${slug} → ${catSlug}`, `groupId=${grpId ?? '?'}  catId=${catId ?? '?'}  (simulated)`);
        continue;
      }
      const link = await prisma.buildPcGroupCategory.findUnique({
        where: { groupId_categoryId: { groupId: grpId, categoryId: catId } },
      });
      if (link) {
        logOp('SKIP', 'GroupCategory', `${slug} → ${catSlug}`);
      } else {
        logOp('CREATE', 'GroupCategory', `${slug} → ${catSlug}`);
        if (!DRY_RUN) {
          await prisma.buildPcGroupCategory.create({ data: { groupId: grpId, categoryId: catId } });
        }
      }
    }
  }
  return groupMap;
}

async function seedCompatibilityRules(groupMap) {
  console.log('\n─── CompatibilityRules (10; luật 11-14 xử lý bằng code) ─────────');
  let unresolved = 0;

  for (const [name, ruleType, groupASlug, attrASlug, groupBSlug, attrBSlug, errorMessage, sortOrder] of RULES) {
    const groupA = groupMap[groupASlug];
    const groupB = groupMap[groupBSlug];

    if (groupA?._virtual || groupB?._virtual || !groupA?.id || !groupB?.id) {
      logOp('CREATE', 'CompatibilityRule', name,
        `${ruleType}  ${groupASlug}.${attrASlug} ↔ ${groupBSlug}.${attrBSlug}  (simulated)`);
      unresolved++;
      continue;
    }

    const existing = await prisma.compatibilityRule.findFirst({
      where: { ruleType, groupAId: groupA.id, groupBId: groupB.id, attributeASlug: attrASlug, attributeBSlug: attrBSlug },
    });
    if (existing) {
      logOp('SKIP', 'CompatibilityRule', name, `id=${existing.id}`);
    } else {
      logOp('CREATE', 'CompatibilityRule', name,
        `${ruleType}  ${groupASlug}.${attrASlug} ↔ ${groupBSlug}.${attrBSlug}`);
      if (!DRY_RUN) {
        await prisma.compatibilityRule.create({
          data: {
            name, ruleType,
            groupAId: groupA.id, attributeASlug: attrASlug,
            groupBId: groupB.id, attributeBSlug: attrBSlug,
            errorMessage, sortOrder, isActive: true,
            config: { severity: 'error' },
          },
        });
      }
    }
  }
  return unresolved;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function runCleanup() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`CLEANUP BUILD PC  ${DRY_RUN ? '[DRY-RUN]' : '[LIVE]'}`);
  console.log(`${'═'.repeat(64)}\n`);

  const seedGroupSlugs = GROUPS.map(g => g[1]);
  const seedAttrSlugs  = NEW_ATTRIBUTES.map(a => a.slug);
  const seedCatSlugs   = NEW_CATEGORIES.map(c => c.slug);
  const seedRuleNames  = RULES.map(r => r[0]);

  console.log('─── CompatibilityRules ───');
  const rules = await prisma.compatibilityRule.findMany({ where: { name: { in: seedRuleNames } } });
  if (!rules.length) console.log('  (none found)');
  for (const r of rules) {
    logOp('DELETE', 'CompatibilityRule', r.name, `id=${r.id}`);
    if (!DRY_RUN) await prisma.compatibilityRule.delete({ where: { id: r.id } });
  }

  console.log('\n─── BuildPcGroups ───');
  const groups = await prisma.buildPcGroup.findMany({
    where: { slug: { in: seedGroupSlugs } },
    include: { _count: { select: { buildItems: true } } },
  });
  if (!groups.length) console.log('  (none found)');
  for (const g of groups) {
    if (g._count.buildItems > 0) {
      logOp('SKIP', 'BuildPcGroup (has items)', g.slug, `buildItems=${g._count.buildItems}`);
    } else {
      logOp('DELETE', 'BuildPcGroup', g.slug, `id=${g.id}`);
      if (!DRY_RUN) await prisma.buildPcGroup.delete({ where: { id: g.id } });
    }
  }

  console.log('\n─── Attributes ───');
  const attrs = await prisma.attribute.findMany({
    where: { slug: { in: seedAttrSlugs } },
    include: { _count: { select: { productValues: true } } },
  });
  if (!attrs.length) console.log('  (none found)');
  for (const a of attrs) {
    if (a._count.productValues > 0) {
      logOp('SKIP', 'Attribute (has product values)', a.slug, `pav=${a._count.productValues}`);
    } else {
      logOp('DELETE', 'Attribute', a.slug, `id=${a.id}`);
      if (!DRY_RUN) await prisma.attribute.delete({ where: { id: a.id } });
    }
  }

  console.log('\n─── Categories ───');
  const cats = await prisma.category.findMany({
    where: { slug: { in: seedCatSlugs } },
    include: { _count: { select: { products: { where: { isDeleted: false } } } } },
  });
  if (!cats.length) console.log('  (none found)');
  for (const c of cats) {
    if (c._count.products > 0) {
      logOp('SKIP', 'Category (has products)', c.slug, `products=${c._count.products}`);
    } else {
      logOp('DELETE', 'Category', c.slug, `id=${c.id}`);
      if (!DRY_RUN) await prisma.category.delete({ where: { id: c.id } });
    }
  }

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`TỔNG KẾT CLEANUP${DRY_RUN ? ' (DRY-RUN)' : ''}: Xóa=${stats.deleted}  Bỏ qua=${stats.skipped}`);
  console.log(`${'═'.repeat(64)}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (CLEANUP) return runCleanup();

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`SEED BUILD PC  ${DRY_RUN ? '[DRY-RUN — chưa ghi vào DB]' : '[LIVE]'}`);
  console.log(`${'═'.repeat(64)}`);

  // ── Load existing ───────────────────────────────────────────────────────────
  const [allCats, allAttrs] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true, parentId: true } }),
    prisma.attribute.findMany({ select: { id: true, slug: true, type: true, usedInBuildPC: true } }),
  ]);
  const existingCatMap  = Object.fromEntries(allCats.map(c => [c.slug, c]));
  const existingAttrMap = Object.fromEntries(allAttrs.map(a => [a.slug, a]));

  // ── Validate ────────────────────────────────────────────────────────────────
  console.log('\n─── Validation ─────────────────────────────────────────────────');
  const errors = await validateRefs(existingCatMap, existingAttrMap);
  if (errors.length) {
    for (const e of errors) console.error('  ' + e);
    console.error(`\nValidation thất bại (${errors.length} lỗi). Không ghi gì vào DB.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('  Tất cả tham chiếu hợp lệ ✓');

  // ── Before counts (live only) ───────────────────────────────────────────────
  const before = DRY_RUN ? null : await queryCounts();

  // ── Seed ────────────────────────────────────────────────────────────────────
  await seedCategories(existingCatMap);
  await seedAttributes(existingAttrMap);
  await seedAttributeValues(existingAttrMap);
  const groupMap   = await seedGroups(existingCatMap);
  const unresolved = await seedCompatibilityRules(groupMap);

  // ── Slot → category table ───────────────────────────────────────────────────
  console.log('\n─── Bảng 20 slot → danh mục ────────────────────────────────────');
  console.log(`  ${'#'.padEnd(3)} ${'Slot slug'.padEnd(24)} ${'Category slug'.padEnd(22)} ${'ID'.padEnd(8)} ${'parentId'}`);
  console.log(`  ${'─'.repeat(75)}`);
  for (const [i, [, slug, catSlugs]] of GROUPS.entries()) {
    for (const [j, cs] of catSlugs.entries()) {
      const c      = existingCatMap[cs];
      const idStr  = c ? `${c.id}${c._virtual ? '*' : ''}` : 'MISSING';
      const pidStr = c ? String(c.parentId ?? 'root') : '?';
      const num    = j === 0 ? String(i + 1).padStart(2) : '  ';
      const slotStr = j === 0 ? slug : '';
      console.log(`  ${num}  ${slotStr.padEnd(24)} ${cs.padEnd(22)} ${idStr.padEnd(8)} ${pidStr}`);
    }
  }
  console.log('  (* = virtual ID from this dry-run)');

  // ── After counts + rule list (live only) ────────────────────────────────────
  if (!DRY_RUN) {
    const after = await queryCounts();
    console.log('\n─── Số bản ghi trước → sau ─────────────────────────────────────');
    const rows = [
      ['BuildPcGroup',         before.buildPcGroup,         after.buildPcGroup],
      ['BuildPcGroupCategory', before.buildPcGroupCategory, after.buildPcGroupCategory],
      ['Category',             before.category,             after.category],
      ['Attribute',            before.attribute,            after.attribute],
      ['AttributeValue',       before.attributeValue,       after.attributeValue],
      ['CompatibilityRule',    before.compatibilityRule,    after.compatibilityRule],
      ['Product',              before.product,              after.product],
      ['ProductAttributeValue',before.productAttributeValue,after.productAttributeValue],
    ];
    for (const [label, b, a] of rows) {
      const change = a - b;
      const mark   = label.startsWith('Product') && change !== 0 ? ' ⚠ UNEXPECTED' : (change > 0 ? ` +${change}` : '');
      console.log(`  ${label.padEnd(26)} ${String(b).padStart(5)} → ${String(a).padStart(5)}${mark}`);
    }

    // Print saved rules
    const savedRules = await prisma.compatibilityRule.findMany({
      where: { name: { in: RULES.map(r => r[0]) } },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const groups = await prisma.buildPcGroup.findMany({ select: { id: true, slug: true } });
    const gById  = Object.fromEntries(groups.map(g => [g.id, g.slug]));
    const attrs  = await prisma.attribute.findMany({ select: { id: true, slug: true, type: true, usedInBuildPC: true } });
    const attrBySlug = Object.fromEntries(attrs.map(a => [a.slug, a]));

    console.log('\n─── 10 luật đã lưu ──────────────────────────────────────────────');
    for (const r of savedRules) {
      const aInfo = attrBySlug[r.attributeASlug];
      const bInfo = attrBySlug[r.attributeBSlug];
      console.log(`\n  [${r.sortOrder}] ${r.name}`);
      console.log(`      ruleType: ${r.ruleType}`);
      console.log(`      groupA: ${gById[r.groupAId] ?? r.groupAId}  attrA: ${r.attributeASlug} (type=${aInfo?.type} buildPC=${aInfo?.usedInBuildPC})`);
      console.log(`      groupB: ${gById[r.groupBId] ?? r.groupBId}  attrB: ${r.attributeBSlug} (type=${bInfo?.type} buildPC=${bInfo?.usedInBuildPC})`);
    }

    // Verify product 206 PAV unchanged
    console.log('\n─── Kiểm tra product 206 (socket-cpu, kich-thuoc-mainboard) ────');
    const pav206 = await prisma.productAttributeValue.findMany({
      where: { productId: 206, attributeId: { in: [32, 34] } },
      include: { attribute: { select: { slug: true, type: true } }, attributeValue: { select: { value: true } } },
    });
    for (const r of pav206) {
      console.log(`  attr=${r.attribute.slug} type=${r.attribute.type} | attributeValueId=${r.attributeValueId} value="${r.attributeValue?.value}" valueText=${r.valueText}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`TỔNG KẾT${DRY_RUN ? ' (DRY-RUN — chưa ghi vào DB)' : ''}`);
  console.log(`  Tạo mới:  ${stats.created}`);
  console.log(`  Bỏ qua:   ${stats.skipped}`);
  console.log(`  Cập nhật: ${stats.updated}`);
  console.log(`  Tham chiếu chưa phân giải: ${unresolved}`);
  console.log(`${'═'.repeat(64)}\n`);
}

main()
  .catch(e => {
    console.error('\nFATAL:', e.message);
    console.error(e.stack?.split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
