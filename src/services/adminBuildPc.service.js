import { prisma } from '../config/prisma.js';
import { evaluateCompatibility } from './compatibility.service.js';

// ── Key attributes that power Build PC compatibility/display, mapped to the ──
// category they apply to. Used for coverage reporting (section 4).
const KEY_ATTRS = [
  { label: 'CPU Socket',              attributeSlug: 'socket-cpu',           categorySlug: 'cpu' },
  { label: 'Chipset',                 attributeSlug: 'chipset',              categorySlug: 'main' },
  { label: 'RAM Type',                attributeSlug: 'loai-ram',             categorySlug: 'ram' },
  { label: 'RAM Capacity',            attributeSlug: 'ram',                  categorySlug: 'ram' },
  { label: 'Mainboard Form Factor',   attributeSlug: 'kich-thuoc-mainboard', categorySlug: 'main' },
  { label: 'GPU Length',              attributeSlug: 'vga-length',           categorySlug: 'vga' },
  { label: 'PSU Wattage',             attributeSlug: 'psu-wattage',          categorySlug: 'nguon' },
  { label: 'Cooler Socket (Air)',     attributeSlug: 'socket-cpu',           categorySlug: 'tan-nhiet-cpu-air' },
  { label: 'Cooler Height',           attributeSlug: 'cooler-height',        categorySlug: 'tan-nhiet-cpu-air' },
  { label: 'Case GPU Clearance',      attributeSlug: 'case-max-vga-length',  categorySlug: 'vo-case' },
  { label: 'Case Cooler Clearance',   attributeSlug: 'case-max-cooler-height', categorySlug: 'vo-case' },
];

// Compatibility checks hardcoded in compatibility.service.js (not DB rows).
// Exposed read-only so admins see the full rule picture.
const CODE_RULES = [
  { code: 'RAM_SLOTS',    name: 'Số module RAM không vượt số khe RAM của Bo mạch chủ', slots: ['ram', 'mainboard'] },
  { code: 'M2_SLOTS',     name: 'Số SSD M.2 không vượt số khe M.2 của Bo mạch chủ',     slots: ['ssd', 'mainboard'] },
  { code: 'PSU_WATTAGE',  name: 'Công suất nguồn đủ cho CPU + VGA (có biên độ an toàn)', slots: ['psu', 'cpu', 'vga'] },
  { code: 'OUT_OF_STOCK', name: 'Linh kiện còn đủ hàng tồn kho',                         slots: ['*'] },
];

// ── Summary / KPIs ───────────────────────────────────────────────────────────

export async function getSummary() {
  const [totalBuilds, valueAgg, topItems] = await Promise.all([
    prisma.pcBuild.count(),
    prisma.$queryRaw`
      SELECT COALESCE(SUM(p.price * pbi.quantity), 0) as totalValue
      FROM PcBuildItem pbi JOIN Product p ON p.id = pbi.productId
    `,
    prisma.pcBuildItem.groupBy({
      by: ['productId'],
      _count: true,
      orderBy: { _count: { productId: 'desc' } },
      take: 5,
    }),
  ]);

  const totalValue = Number(valueAgg[0]?.totalValue ?? 0);
  const avgValue = totalBuilds > 0 ? Math.round(totalValue / totalBuilds) : 0;

  const products = await prisma.product.findMany({
    where: { id: { in: topItems.map(i => i.productId) } },
    select: { id: true, name: true, slug: true },
  });
  const nameMap = Object.fromEntries(products.map(p => [p.id, p]));

  return {
    totalBuilds,
    avgValue,
    totalValue,
    // No cart/order linkage exists on PcBuild today — not fabricated here.
    topComponents: topItems.map(i => ({
      productId: i.productId,
      name: nameMap[i.productId]?.name ?? '—',
      slug: nameMap[i.productId]?.slug ?? null,
      pickCount: i._count,
    })),
  };
}

// ── Compatibility rules (DB-backed, structured-attribute based) ─────────────

export async function listRules() {
  const [rules, groups] = await Promise.all([
    prisma.compatibilityRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.buildPcGroup.findMany({ select: { id: true, slug: true, name: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  return {
    rules: rules.map(r => ({
      ...r,
      groupA: groupById[r.groupAId] ?? null,
      groupB: groupById[r.groupBId] ?? null,
    })),
    groups,
    codeRules: CODE_RULES,
  };
}

export async function createRule(data) {
  return prisma.compatibilityRule.create({
    data: {
      name: data.name,
      description: data.description || null,
      ruleType: data.ruleType,
      groupAId: data.groupAId,
      attributeASlug: data.attributeASlug,
      groupBId: data.groupBId,
      attributeBSlug: data.attributeBSlug,
      config: data.severity ? { severity: data.severity } : undefined,
      errorMessage: data.errorMessage || null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
}

export async function updateRule(id, data) {
  const existing = await prisma.compatibilityRule.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Quy tắc không tồn tại.'); e.status = 404; throw e; }
  return prisma.compatibilityRule.update({
    where: { id },
    data: {
      name: data.name, description: data.description || null, ruleType: data.ruleType,
      groupAId: data.groupAId, attributeASlug: data.attributeASlug,
      groupBId: data.groupBId, attributeBSlug: data.attributeBSlug,
      config: data.severity ? { severity: data.severity } : existing.config,
      errorMessage: data.errorMessage || null,
      isActive: data.isActive, sortOrder: data.sortOrder,
    },
  });
}

export async function deleteRule(id) {
  const existing = await prisma.compatibilityRule.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Quy tắc không tồn tại.'); e.status = 404; throw e; }
  await prisma.compatibilityRule.delete({ where: { id } });
}

// ── Presets (admin-curated suggestions — not wired into customer Build PC) ──

function presetSelect() {
  return {
    id: true, name: true, slug: true, description: true, useCase: true,
    budgetMin: true, budgetMax: true, isActive: true, sortOrder: true,
    createdAt: true, updatedAt: true,
    items: {
      select: {
        id: true, groupId: true, productId: true,
        group: { select: { id: true, slug: true, name: true } },
        product: { select: { id: true, name: true, slug: true, price: true, isActive: true, isDeleted: true } },
      },
    },
  };
}

export async function listPresets() {
  return prisma.buildPcPreset.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: presetSelect() });
}

export async function getPreset(id) {
  return prisma.buildPcPreset.findUnique({ where: { id }, select: presetSelect() });
}

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function createPreset(data) {
  const slug = data.slug?.trim() || slugify(data.name);
  const existing = await prisma.buildPcPreset.findUnique({ where: { slug } });
  if (existing) { const e = new Error('Slug preset đã tồn tại.'); e.status = 409; throw e; }

  return prisma.buildPcPreset.create({
    data: {
      name: data.name, slug, description: data.description || null, useCase: data.useCase || null,
      budgetMin: data.budgetMin ?? null, budgetMax: data.budgetMax ?? null,
      isActive: data.isActive ?? true, sortOrder: data.sortOrder ?? 0,
      items: data.items?.length
        ? { create: data.items.map(i => ({ groupId: i.groupId, productId: i.productId ?? null })) }
        : undefined,
    },
    select: presetSelect(),
  });
}

export async function updatePreset(id, data) {
  const existing = await prisma.buildPcPreset.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Preset không tồn tại.'); e.status = 404; throw e; }

  if (data.slug && data.slug !== existing.slug) {
    const dup = await prisma.buildPcPreset.findUnique({ where: { slug: data.slug } });
    if (dup) { const e = new Error('Slug preset đã tồn tại.'); e.status = 409; throw e; }
  }

  return prisma.$transaction(async tx => {
    if (data.items) {
      await tx.buildPcPresetItem.deleteMany({ where: { presetId: id } });
      if (data.items.length) {
        await tx.buildPcPresetItem.createMany({
          data: data.items.map(i => ({ presetId: id, groupId: i.groupId, productId: i.productId ?? null })),
        });
      }
    }
    return tx.buildPcPreset.update({
      where: { id },
      data: {
        name: data.name, slug: data.slug || existing.slug, description: data.description || null,
        useCase: data.useCase || null, budgetMin: data.budgetMin ?? null, budgetMax: data.budgetMax ?? null,
        isActive: data.isActive, sortOrder: data.sortOrder,
      },
      select: presetSelect(),
    });
  });
}

export async function deletePreset(id) {
  const existing = await prisma.buildPcPreset.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Preset không tồn tại.'); e.status = 404; throw e; }
  await prisma.buildPcPreset.delete({ where: { id } });
}

// ── Attribute coverage (section 4) ───────────────────────────────────────────

export async function getAttributeCoverage() {
  const categories = await prisma.category.findMany({
    where: { slug: { in: [...new Set(KEY_ATTRS.map(a => a.categorySlug))] } },
    select: { id: true, slug: true },
  });
  const catIdBySlug = Object.fromEntries(categories.map(c => [c.slug, c.id]));

  const results = await Promise.all(KEY_ATTRS.map(async def => {
    const categoryId = catIdBySlug[def.categorySlug];
    if (!categoryId) return { ...def, total: 0, withData: 0, missing: 0 };

    const [total, withData] = await Promise.all([
      prisma.product.count({ where: { categoryId, isActive: true, isDeleted: false } }),
      prisma.product.count({
        where: {
          categoryId, isActive: true, isDeleted: false,
          attributeValues: { some: { attribute: { slug: def.attributeSlug } } },
        },
      }),
    ]);
    return { ...def, total, withData, missing: total - withData };
  }));

  return results;
}

export async function getProductsMissingAttribute(categorySlug, attributeSlug, { page = 1, limit = 20 } = {}) {
  const category = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } });
  if (!category) return { products: [], total: 0, page, limit };

  const where = {
    categoryId: category.id, isActive: true, isDeleted: false,
    attributeValues: { none: { attribute: { slug: attributeSlug } } },
  };
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where, select: { id: true, name: true, slug: true, sku: true },
      orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit,
    }),
    prisma.product.count({ where }),
  ]);
  return { products, total, page, limit };
}

// ── Build sessions (section 5 & 6) ───────────────────────────────────────────

export async function listBuildSessions({ page = 1, limit = 20, from, to, userId, minPrice, maxPrice } = {}) {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
  }
  if (userId) where.userId = Number(userId);

  const [builds, groups] = await Promise.all([
    prisma.pcBuild.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, price: true, isActive: true, isDeleted: true, stockQuantity: true } } } },
      },
    }),
    prisma.buildPcGroup.findMany({ select: { id: true, slug: true, name: true, isRequired: true } }),
  ]);
  const groupById = new Map(groups.map(g => [g.id, g]));

  let sessions = builds.map(b => {
    const total = b.items.reduce((s, i) => s + i.product.price * i.quantity, 0);
    const configItems = b.items.map(i => ({
      slotSlug: groupById.get(i.groupId)?.slug, quantity: i.quantity,
      product: { ...i.product, attributeValues: [], categoryId: null },
    }));
    const hasUnavailable = b.items.some(i => !i.product.isActive || i.product.isDeleted);
    return {
      id: b.id, shareCode: b.shareCode,
      user: b.user ? { id: b.user.id, fullName: b.user.fullName, email: b.user.email } : null,
      total, itemCount: b.items.length, createdAt: b.createdAt,
      hasUnavailableItems: hasUnavailable,
    };
  });

  if (minPrice != null) sessions = sessions.filter(s => s.total >= Number(minPrice));
  if (maxPrice != null) sessions = sessions.filter(s => s.total <= Number(maxPrice));

  const total = sessions.length;
  const paged = sessions.slice((page - 1) * limit, page * limit);
  return { sessions: paged, total, page, limit };
}

export async function getBuildSessionDetail(id) {
  const build = await prisma.pcBuild.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      items: {
        include: {
          group: { select: { id: true, slug: true, name: true, isRequired: true } },
          product: {
            select: {
              id: true, name: true, slug: true, price: true, isActive: true, isDeleted: true, stockQuantity: true, categoryId: true,
              attributeValues: { include: { attribute: true, attributeValue: true } },
            },
          },
        },
      },
    },
  });
  if (!build) return null;

  const [rules, categories] = await Promise.all([
    prisma.compatibilityRule.findMany({ where: { isActive: true } }),
    prisma.category.findMany({ select: { id: true, slug: true } }),
  ]);
  const categorySlugById = new Map(categories.map(c => [c.id, c.slug]));
  const groupById = new Map(build.items.map(i => [i.group.id, i.group]));
  const configItems = build.items.map(i => ({ slotSlug: i.group.slug, quantity: i.quantity, product: i.product }));

  const { issues, missing } = evaluateCompatibility({ configItems, groupById, rules, categorySlugById });
  const total = build.items.reduce((s, i) => s + i.product.price * i.quantity, 0);

  return {
    id: build.id, shareCode: build.shareCode,
    user: build.user ? { id: build.user.id, fullName: build.user.fullName, email: build.user.email } : null,
    createdAt: build.createdAt, total,
    items: build.items.map(i => ({
      groupSlug: i.group.slug, groupName: i.group.name,
      product: { id: i.product.id, name: i.product.name, slug: i.product.slug, price: i.product.price, isActive: i.product.isActive, isDeleted: i.product.isDeleted, stockQuantity: i.product.stockQuantity },
      quantity: i.quantity,
    })),
    compatibility: { issues, missing },
  };
}

// ── Data issues ("Cần xử lý") ─────────────────────────────────────────────────

export async function getDataIssues() {
  const [coverage, presets, buildsWithUnavailable, orphanRules] = await Promise.all([
    getAttributeCoverage(),
    prisma.buildPcPreset.findMany({
      where: { isActive: true },
      select: { id: true, name: true, items: { select: { product: { select: { id: true, name: true, isActive: true, isDeleted: true } } } } },
    }),
    prisma.$queryRaw`
      SELECT DISTINCT pb.id, pb.shareCode
      FROM PcBuild pb
      JOIN PcBuildItem pbi ON pbi.buildId = pb.id
      JOIN Product p ON p.id = pbi.productId
      WHERE p.isActive = 0 OR p.isDeleted = 1
    `,
    prisma.compatibilityRule.findMany({ where: { isActive: true }, select: { id: true, name: true, attributeASlug: true, attributeBSlug: true } }),
  ]);

  const missingAttrTotal = coverage.reduce((s, c) => s + c.missing, 0);

  const presetsWithHiddenProducts = presets
    .map(p => ({ id: p.id, name: p.name, hiddenCount: p.items.filter(i => i.product && (!i.product.isActive || i.product.isDeleted)).length }))
    .filter(p => p.hiddenCount > 0);

  const allAttrSlugs = new Set((await prisma.attribute.findMany({ select: { slug: true } })).map(a => a.slug));
  const rulesWithMissingAttr = orphanRules.filter(r => !allAttrSlugs.has(r.attributeASlug) || !allAttrSlugs.has(r.attributeBSlug));

  return {
    missingAttributesTotal: missingAttrTotal,
    attributeCoverage: coverage.filter(c => c.missing > 0),
    rulesWithMissingAttribute: rulesWithMissingAttr,
    presetsWithHiddenProducts,
    buildsWithUnavailableItems: buildsWithUnavailable.map(b => ({ id: b.id, shareCode: b.shareCode })),
  };
}
