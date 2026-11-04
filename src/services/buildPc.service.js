import { randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { whereForQuery } from './productCatalog.service.js';
import { resolveBrandFilter } from './brand.service.js';
import { MAX_ITEMS, RULE_TYPES } from '../config/buildPc.config.js';
import { evaluateCompatibility } from './compatibility.service.js';

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings() {
  return prisma.buildPcSettings.findUnique({ where: { id: 1 } });
}

// ── Slots ─────────────────────────────────────────────────────────────────────

export async function getSlots() {
  const [settings, groups] = await Promise.all([
    getSettings(),
    prisma.buildPcGroup.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        categories: {
          include: { category: { select: { id: true, slug: true, name: true } } },
        },
      },
    }),
  ]);
  return {
    slots: groups.map(g => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      isRequired: g.isRequired,
      minCount: g.minCount,
      maxCount: g.maxCount,
      badgeText: g.badgeText,
      exclusiveGroup: g.exclusiveGroup,
      categories: g.categories.map(gc => ({
        id: gc.category.id,
        slug: gc.category.slug,
        name: gc.category.name,
      })),
    })),
    meta: {
      manualBuildEnabled: settings?.manualBuildEnabled ?? true,
      inStockOnly: settings?.inStockOnly ?? true,
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveSlot(slug) {
  if (!slug) return null;
  const group = await prisma.buildPcGroup.findFirst({
    where: { slug, isActive: true },
    include: { categories: { select: { categoryId: true } } },
  });
  return group;
}

async function buildProductWhere(catIds, filters, resolvedBrand, inStockOnly = false) {
  const filterWithoutCategory = { ...filters, category: undefined, status: undefined };
  const where = await whereForQuery(filterWithoutCategory, resolvedBrand);
  where.categoryId = { in: catIds };
  where.isActive = true;
  where.isDeleted = false;
  if (inStockOnly) where.stockQuantity = { gt: 0 };
  return where;
}

const ORDER_MAP = {
  default:    [{ id: 'asc' }],
  price_asc:  [{ price: 'asc' },  { id: 'asc' }],
  price_desc: [{ price: 'desc' }, { id: 'asc' }],
  name_asc:   [{ name: 'asc' },  { id: 'asc' }],
};

const VALID_SORTS = new Set(Object.keys(ORDER_MAP));

function validateSort(sort) {
  if (sort && !VALID_SORTS.has(sort)) {
    const err = new Error(`Tham số sort không hợp lệ. Các giá trị hợp lệ: ${[...VALID_SORTS].join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }
}

// ── Compatibility filter helpers ──────────────────────────────────────────────

// Apply compat AND conditions on top of an existing where clause (immutable).
function applyCompatToWhere(where, andConditions) {
  if (!andConditions.length) return where;
  const result = { ...where };
  const existing = result.AND;
  if (!existing) result.AND = andConditions;
  else if (Array.isArray(existing)) result.AND = [...existing, ...andConditions];
  else result.AND = [existing, ...andConditions];
  return result;
}

// Build a Prisma WHERE condition for one rule in one direction.
// Returns a condition object or null if data is insufficient.
function buildRuleCondition(ruleType, openAttrSlug, direction, sameSlug, otherPavs) {
  if (ruleType === RULE_TYPES.ATTR_MATCH) {
    if (sameSlug) {
      const ids = otherPavs.map(av => av.attributeValueId).filter(Boolean);
      if (!ids.length) return null;
      return { OR: [
        { attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValueId: { in: ids } } } },
        { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug } } } } },
      ]};
    } else {
      const vals = otherPavs.map(av => av.attributeValue?.value?.trim().toLowerCase()).filter(Boolean);
      if (!vals.length) return null;
      return { OR: [
        { attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValue: { value: { in: vals } } } } },
        { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug } } } } },
      ]};
    }
  }

  if (ruleType === RULE_TYPES.ATTR_SUBSET) {
    if (direction === 'A') {
      // open (A) ⊆ other (B): open must not have values outside other's set
      if (sameSlug) {
        const ids = otherPavs.map(av => av.attributeValueId).filter(Boolean);
        if (!ids.length) return null;
        // Exclude products with any value NOT in other's set; allow no values (unknown)
        return { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValueId: { notIn: ids } } } } };
      } else {
        const vals = otherPavs.map(av => av.attributeValue?.value?.trim().toLowerCase()).filter(Boolean);
        if (!vals.length) return null;
        return { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValue: { value: { notIn: vals } } } } } };
      }
    } else {
      // open (B) ⊇ other (A): open must contain every value of other
      if (sameSlug) {
        const ids = otherPavs.map(av => av.attributeValueId).filter(Boolean);
        if (!ids.length) return null;
        return { OR: [
          { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug } } } } },
          { AND: ids.map(id => ({ attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValueId: id } } })) },
        ]};
      } else {
        const vals = otherPavs.map(av => av.attributeValue?.value?.trim().toLowerCase()).filter(Boolean);
        if (!vals.length) return null;
        return { OR: [
          { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug } } } } },
          { AND: vals.map(v => ({ attributeValues: { some: { attribute: { slug: openAttrSlug }, attributeValue: { value: v } } } })) },
        ]};
      }
    }
  }

  if (ruleType === RULE_TYPES.ATTR_LTE) {
    const pav = otherPavs[0];
    const n = pav?.valueNumber !== null && pav?.valueNumber !== undefined ? Number(pav.valueNumber) : null;
    if (n === null || isNaN(n)) return null;
    if (direction === 'A') {
      // open.number <= other.number — exclude products with number > other
      return { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug }, valueNumber: { gt: n } } } } };
    } else {
      // open.number >= other.number — exclude products with number < other
      return { NOT: { attributeValues: { some: { attribute: { slug: openAttrSlug }, valueNumber: { lt: n } } } } };
    }
  }

  return null;
}

// Synchronously build compat conditions from pre-fetched data.
function buildCompatConditions(openSlug, selectedProductsData, rules, groupSlugById, selectedSlotsSet) {
  const andConditions = [];
  const relevantAttrSlugs = new Set();
  let compatApplicable = false;

  for (const rule of rules) {
    const slotA = groupSlugById.get(rule.groupAId);
    const slotB = groupSlugById.get(rule.groupBId);
    if (!slotA || !slotB) continue;

    let openAttrSlug, otherAttrSlug, otherSlug, direction;
    if (slotA === openSlug) {
      openAttrSlug = rule.attributeASlug;
      otherAttrSlug = rule.attributeBSlug;
      otherSlug = slotB;
      direction = 'A';
    } else if (slotB === openSlug) {
      openAttrSlug = rule.attributeBSlug;
      otherAttrSlug = rule.attributeASlug;
      otherSlug = slotA;
      direction = 'B';
    } else {
      continue;
    }

    if (!selectedSlotsSet.has(otherSlug)) continue;
    compatApplicable = true; // at least one relevant rule with a selected other-slot product

    const otherProductData = selectedProductsData.find(p => p._slot === otherSlug);
    if (!otherProductData) continue;

    const otherPavs = otherProductData.attributeValues.filter(av => av.attribute?.slug === otherAttrSlug);
    if (!otherPavs.length) continue; // other product has no attribute data → skip (don't filter)

    relevantAttrSlugs.add(openAttrSlug);

    const sameSlug = rule.attributeASlug === rule.attributeBSlug;
    const cond = buildRuleCondition(rule.ruleType, openAttrSlug, direction, sameSlug, otherPavs);
    if (cond) andConditions.push(cond);
  }

  return { andConditions, relevantAttrSlugs, compatApplicable };
}

// Async: fetch groups + rules + selected products, then build compat conditions.
// Returns { andConditions, relevantAttrSlugs, compatApplicable } or null if no selected items.
async function resolveCompatData(openSlug, selected) {
  if (!selected.length) return { andConditions: [], relevantAttrSlugs: new Set(), compatApplicable: false };

  const selectedSlotsSet = new Set(selected.map(s => s.slot));

  const [allGroups, rules, selectedProducts] = await Promise.all([
    prisma.buildPcGroup.findMany({ where: { isActive: true }, select: { id: true, slug: true } }),
    prisma.compatibilityRule.findMany({ where: { isActive: true } }),
    prisma.product.findMany({
      where: { id: { in: selected.map(s => s.productId) }, isActive: true, isDeleted: false },
      select: {
        id: true,
        attributeValues: {
          include: {
            attribute: { select: { slug: true } },
            attributeValue: { select: { value: true } },
          },
        },
      },
    }),
  ]);

  const groupSlugById = new Map(allGroups.map(g => [g.id, g.slug]));

  const selectedProductsData = selected.flatMap(s => {
    const product = selectedProducts.find(p => p.id === s.productId);
    return product ? [{ ...product, _slot: s.slot }] : [];
  });

  return buildCompatConditions(openSlug, selectedProductsData, rules, groupSlugById, selectedSlotsSet);
}

// ── Products ──────────────────────────────────────────────────────────────────

export async function listBuildPcProducts(slotSlug, filters, settings, compatParams = {}) {
  validateSort(filters.sort);

  const group = await resolveSlot(slotSlug);
  if (!group) {
    const err = new Error('Không tìm thấy slot Build PC.');
    err.statusCode = 404;
    throw err;
  }
  const catIds = group.categories.map(gc => gc.categoryId);
  const inStockOnly = settings?.inStockOnly && !filters.inStockOverride;

  const { compatOnly = false, selected = [] } = compatParams;

  const [resolvedBrand, compatData] = await Promise.all([
    resolveBrandFilter(filters),
    selected.length > 0 ? resolveCompatData(slotSlug, selected) : Promise.resolve(null),
  ]);

  const whereBase = await buildProductWhere(catIds, filters, resolvedBrand, inStockOnly);
  const andConditions = compatData?.andConditions ?? [];
  // Apply compat filter only when toggle is on; always compute compatApplicable
  const effectiveConditions = compatOnly ? andConditions : [];
  const whereCompat = applyCompatToWhere(whereBase, effectiveConditions);
  const compatApplicable = compatData?.compatApplicable ?? false;
  const relevantAttrSlugs = compatData?.relevantAttrSlugs ?? new Set();
  const needAttrValues = compatOnly && compatApplicable && relevantAttrSlugs.size > 0;

  const page  = Math.max(Number.parseInt(filters.page, 10)  || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 20, 1), 50);
  const orderBy = ORDER_MAP[filters.sort] || ORDER_MAP.default;
  const skip = (page - 1) * limit;

  const WARRANTY_SPEC_NAME = 'Bảo hành';

  const productSelect = {
    id: true,
    slug: true,
    sku: true,
    name: true,
    price: true,
    stockQuantity: true,
    brandRecord: { select: { id: true, name: true } },
    images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 },
    specifications: { where: { name: WARRANTY_SPEC_NAME }, select: { value: true }, take: 1 },
  };
  if (needAttrValues) {
    productSelect.attributeValues = { select: { attribute: { select: { slug: true } } } };
  }

  const hasFilter = effectiveConditions.length > 0;

  const [rows, total, totalBase] = await Promise.all([
    prisma.product.findMany({ where: whereCompat, orderBy, skip, take: limit, select: productSelect }),
    prisma.product.count({ where: whereCompat }),
    hasFilter ? prisma.product.count({ where: whereBase }) : Promise.resolve(null),
  ]);

  const items = rows.map(p => {
    const primaryImage = p.images[0]?.imageUrl ?? null;
    const item = {
      id: p.id, slug: p.slug, sku: p.sku, name: p.name,
      price: Number(p.price), stockQuantity: p.stockQuantity,
      inStock: p.stockQuantity > 0, primaryImage,
      brand: p.brandRecord ? { id: p.brandRecord.id, name: p.brandRecord.name } : null,
      warranty: p.specifications[0]?.value ?? null,
    };
    if (compatOnly && compatApplicable) {
      if (needAttrValues) {
        const presentSlugs = new Set((p.attributeValues ?? []).map(av => av.attribute?.slug).filter(Boolean));
        item.compat = [...relevantAttrSlugs].some(slug => !presentSlugs.has(slug)) ? 'unknown' : 'ok';
      } else {
        item.compat = 'unknown';
      }
    }
    return item;
  });

  // Supplement missing primary images
  const needsImage = items.filter(item => item.primaryImage === null);
  if (needsImage.length) {
    const ids = needsImage.map(item => item.id);
    const fallbacks = await prisma.productImage.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, imageUrl: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      distinct: ['productId'],
    });
    const fallbackMap = new Map(fallbacks.map(f => [f.productId, f.imageUrl]));
    for (const item of items) {
      if (item.primaryImage === null && fallbackMap.has(item.id)) {
        item.primaryImage = fallbackMap.get(item.id);
      }
    }
  }

  const hiddenByCompat = totalBase !== null ? totalBase - total : undefined;

  return {
    data: items,
    meta: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      ...(selected.length > 0 ? { compatApplicable } : {}),
      ...(compatOnly && hasFilter ? { hiddenByCompat: hiddenByCompat ?? 0 } : {}),
    },
  };
}

// ── Facets ────────────────────────────────────────────────────────────────────

export async function getBuildPcFacets(slotSlug, filters, settings, compatParams = {}) {
  const group = await resolveSlot(slotSlug);
  if (!group) {
    const err = new Error('Không tìm thấy slot Build PC.');
    err.statusCode = 404;
    throw err;
  }
  const catIds = group.categories.map(gc => gc.categoryId);
  const inStockOnly = settings?.inStockOnly && !filters.inStockOverride;

  const { compatOnly = false, selected = [] } = compatParams;

  const [resolvedBrand, compatData] = await Promise.all([
    resolveBrandFilter(filters),
    selected.length > 0 ? resolveCompatData(slotSlug, selected) : Promise.resolve(null),
  ]);

  const andConditions = compatData?.andConditions ?? [];
  const compatApplicable = compatData?.compatApplicable ?? false;
  const effectiveFacetConditions = compatOnly ? andConditions : [];
  const attrFilters = filters.attributeFilters || [];

  const whereAllBase = await buildProductWhere(catIds, filters, resolvedBrand, inStockOnly);
  const whereAll = applyCompatToWhere(whereAllBase, effectiveFacetConditions);

  // ── Brand counts ──────────────────────────────────────────────────────────
  const brandGroups = await prisma.product.groupBy({
    by: ['brandId'],
    where: { ...whereAll, brandId: { not: null } },
    _count: { _all: true },
  });
  const brandCountMap = new Map(brandGroups.map(r => [r.brandId, r._count._all]));
  const brandRecords = brandCountMap.size
    ? await prisma.brand.findMany({
        where: { id: { in: [...brandCountMap.keys()] }, isActive: true },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    : [];
  const brands = brandRecords.map(b => ({ id: b.id, name: b.name, count: brandCountMap.get(b.id) || 0 }));

  // ── Price range ───────────────────────────────────────────────────────────
  const whereForPriceBase = await buildProductWhere(
    catIds, { ...filters, minPrice: undefined, maxPrice: undefined }, resolvedBrand, inStockOnly
  );
  const whereForPrice = applyCompatToWhere(whereForPriceBase, effectiveFacetConditions);
  const priceAgg = await prisma.product.aggregate({
    where: whereForPrice,
    _min: { price: true },
    _max: { price: true },
  });

  // ── Attribute facets ──────────────────────────────────────────────────────
  const catAttrLinks = await prisma.categoryAttribute.findMany({
    where: {
      categoryId: { in: catIds },
      attribute: { isActive: true, type: { in: ['SELECT', 'MULTI_SELECT'] } },
    },
    include: {
      attribute: {
        include: { values: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { attributeId: 'asc' }],
  });

  const seenAttrIds = new Set();
  const uniqueAttrs = [];
  for (const link of catAttrLinks) {
    if (!seenAttrIds.has(link.attributeId)) {
      seenAttrIds.add(link.attributeId);
      uniqueAttrs.push(link.attribute);
    }
  }

  const attributeFacets = [];
  for (const attr of uniqueAttrs) {
    const filtersWithoutThis = {
      ...filters,
      attributeFilters: attrFilters.filter(f => f.slug !== attr.slug),
    };
    const whereExcludeSelfBase = await buildProductWhere(catIds, filtersWithoutThis, resolvedBrand, inStockOnly);
    const whereExcludeSelf = applyCompatToWhere(whereExcludeSelfBase, effectiveFacetConditions);

    const valueGroups = await prisma.productAttributeValue.groupBy({
      by: ['attributeValueId'],
      where: { attributeId: attr.id, attributeValueId: { not: null }, product: whereExcludeSelf },
      _count: { _all: true },
    });
    const valueCountMap = new Map(valueGroups.map(r => [r.attributeValueId, r._count._all]));

    const values = attr.values
      .filter(v => valueCountMap.has(v.id))
      .map(v => ({ id: v.id, value: v.value, count: valueCountMap.get(v.id) }));

    if (values.length > 0) {
      attributeFacets.push({ id: attr.id, slug: attr.slug, name: attr.name, type: attr.type, values });
    }
  }

  return {
    data: {
      brands,
      attributes: attributeFacets,
      priceRange: {
        min: priceAgg._min.price !== null ? Number(priceAgg._min.price) : null,
        max: priceAgg._max.price !== null ? Number(priceAgg._max.price) : null,
      },
    },
    meta: { ...(selected.length > 0 ? { compatApplicable } : {}) },
  };
}

// ── Validate build configuration ──────────────────────────────────────────

export async function validateBuildConfig(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const err = new Error('items phải là mảng không rỗng.'); err.statusCode = 400; throw err;
  }
  if (rawItems.length > MAX_ITEMS) {
    const err = new Error(`items không được vượt quá ${MAX_ITEMS} dòng.`); err.statusCode = 400; throw err;
  }

  const allGroups = await prisma.buildPcGroup.findMany({
    where: { isActive: true },
    include: { categories: { select: { categoryId: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  const groupBySlug  = new Map(allGroups.map(g => [g.slug, g]));
  const groupById    = new Map(allGroups.map(g => [g.id, g]));
  const catIdsBySlug = new Map(allGroups.map(g => [g.slug, new Set(g.categories.map(c => c.categoryId))]));

  const seenSlots    = new Set();
  const exclusiveCount = new Map();

  for (const item of rawItems) {
    if (typeof item.slot !== 'string' || !item.slot) {
      const err = new Error('slot phải là chuỗi không rỗng.'); err.statusCode = 400; throw err;
    }
    const group = groupBySlug.get(item.slot);
    if (!group) {
      const err = new Error(`Slot "${item.slot}" không tồn tại.`); err.statusCode = 400; throw err;
    }
    if (seenSlots.has(item.slot)) {
      const err = new Error(`Slot "${item.slot}" bị trùng.`); err.statusCode = 400; throw err;
    }
    seenSlots.add(item.slot);

    if (!Number.isInteger(item.productId) || item.productId <= 0) {
      const err = new Error('productId phải là số nguyên dương.'); err.statusCode = 400; throw err;
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > group.maxCount) {
      const err = new Error(`quantity của slot "${item.slot}" phải từ 1 đến ${group.maxCount}.`); err.statusCode = 400; throw err;
    }
    if (group.exclusiveGroup) {
      exclusiveCount.set(group.exclusiveGroup, (exclusiveCount.get(group.exclusiveGroup) ?? 0) + 1);
    }
  }
  for (const [eg, cnt] of exclusiveCount) {
    if (cnt > 1) {
      const err = new Error(`Chỉ được chọn một slot trong nhóm "${eg}".`); err.statusCode = 400; throw err;
    }
  }

  const productIds = rawItems.map(i => i.productId);
  const dbProds = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, slug: true, sku: true, name: true,
      price: true, stockQuantity: true,
      isActive: true, isDeleted: true, categoryId: true,
      attributeValues: {
        include: {
          attribute:      { select: { id: true, slug: true, type: true } },
          attributeValue: { select: { id: true, value: true } },
        },
      },
      images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } },
    },
  });
  const prodById = new Map(dbProds.map(p => [p.id, p]));

  for (const item of rawItems) {
    const prod = prodById.get(item.productId);
    if (!prod) {
      const err = new Error(`Sản phẩm ${item.productId} không tồn tại.`); err.statusCode = 400; throw err;
    }
    if (!prod.isActive || prod.isDeleted) {
      const err = new Error(`Sản phẩm "${prod.name}" không còn bán.`); err.statusCode = 400; throw err;
    }
    const catIds = catIdsBySlug.get(item.slot);
    if (!catIds || !catIds.has(prod.categoryId)) {
      const err = new Error(`Sản phẩm "${prod.name}" không thuộc slot "${item.slot}".`); err.statusCode = 400; throw err;
    }
  }

  const noImage = dbProds.filter(p => p.images.length === 0);
  if (noImage.length) {
    const fallbacks = await prisma.productImage.findMany({
      where: { productId: { in: noImage.map(p => p.id) } },
      select: { productId: true, imageUrl: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      distinct: ['productId'],
    });
    const fbMap = new Map(fallbacks.map(f => [f.productId, f.imageUrl]));
    for (const prod of noImage) {
      if (fbMap.has(prod.id)) prod.images = [{ imageUrl: fbMap.get(prod.id) }];
    }
  }

  const [rules, catRecords] = await Promise.all([
    prisma.compatibilityRule.findMany({ where: { isActive: true } }),
    prisma.category.findMany({
      where: { id: { in: [...new Set(dbProds.map(p => p.categoryId).filter(Boolean))] } },
      select: { id: true, slug: true },
    }),
  ]);
  const categorySlugById = new Map(catRecords.map(c => [c.id, c.slug]));

  const configItems = rawItems.map(item => ({
    slotSlug: item.slot,
    product:  prodById.get(item.productId),
    quantity: item.quantity,
  }));

  const { issues, missing } = evaluateCompatibility({ configItems, groupById, rules, categorySlugById });

  let total = 0;
  const items = rawItems.map(item => {
    const prod      = prodById.get(item.productId);
    const price     = Number(prod.price);
    const lineTotal = price * item.quantity;
    total += lineTotal;
    return {
      slot: item.slot, productId: prod.id,
      slug: prod.slug, sku: prod.sku, name: prod.name,
      price, quantity: item.quantity, lineTotal,
      stockQuantity: prod.stockQuantity,
      primaryImage: prod.images[0]?.imageUrl ?? null,
    };
  });

  const hasErrorIssue = issues.some(i => i.level === 'error');
  const canAddToCart  = !hasErrorIssue; // ≥1 item guaranteed by validateSaveItems guard above
  const isComplete    = missing.length === 0 && !hasErrorIssue;

  return { data: { items, total, issues, missing, canAddToCart, isComplete }, meta: {}, message: 'OK' };
}

// ── Save & share build config ─────────────────────────────────────────────────

// 32-char alphabet without 0,O,1,I,l — 256 % 32 = 0, no modulo bias
const SHARE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateShareCode(len = 8) {
  const bytes = randomBytes(len);
  return Array.from(bytes, b => SHARE_CHARSET[b % SHARE_CHARSET.length]).join('');
}

// Validate items for save: same input checks as validateBuildConfig, without compat evaluation.
// Returns { groupBySlug, catIdsBySlug, prodById } for reuse.
async function validateSaveItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const err = new Error('items phải là mảng không rỗng.'); err.statusCode = 400; throw err;
  }
  if (rawItems.length > MAX_ITEMS) {
    const err = new Error(`items không được vượt quá ${MAX_ITEMS} dòng.`); err.statusCode = 400; throw err;
  }

  const allGroups = await prisma.buildPcGroup.findMany({
    where: { isActive: true },
    include: { categories: { select: { categoryId: true } } },
  });
  const groupBySlug  = new Map(allGroups.map(g => [g.slug, g]));
  const catIdsBySlug = new Map(allGroups.map(g => [g.slug, new Set(g.categories.map(c => c.categoryId))]));

  const seenSlots = new Set();
  const exclusiveCount = new Map();

  for (const item of rawItems) {
    if (typeof item.slot !== 'string' || !item.slot) {
      const err = new Error('slot phải là chuỗi không rỗng.'); err.statusCode = 400; throw err;
    }
    const group = groupBySlug.get(item.slot);
    if (!group) {
      const err = new Error(`Slot "${item.slot}" không tồn tại.`); err.statusCode = 400; throw err;
    }
    if (seenSlots.has(item.slot)) {
      const err = new Error(`Slot "${item.slot}" bị trùng.`); err.statusCode = 400; throw err;
    }
    seenSlots.add(item.slot);
    if (!Number.isInteger(item.productId) || item.productId <= 0) {
      const err = new Error('productId phải là số nguyên dương.'); err.statusCode = 400; throw err;
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > group.maxCount) {
      const err = new Error(`quantity của slot "${item.slot}" phải từ 1 đến ${group.maxCount}.`); err.statusCode = 400; throw err;
    }
    if (group.exclusiveGroup) {
      exclusiveCount.set(group.exclusiveGroup, (exclusiveCount.get(group.exclusiveGroup) ?? 0) + 1);
    }
  }
  for (const [eg, cnt] of exclusiveCount) {
    if (cnt > 1) {
      const err = new Error(`Chỉ được chọn một slot trong nhóm "${eg}".`); err.statusCode = 400; throw err;
    }
  }

  const dbProds = await prisma.product.findMany({
    where: { id: { in: rawItems.map(i => i.productId) } },
    select: { id: true, name: true, isActive: true, isDeleted: true, categoryId: true },
  });
  const prodById = new Map(dbProds.map(p => [p.id, p]));

  for (const item of rawItems) {
    const prod = prodById.get(item.productId);
    if (!prod) {
      const err = new Error(`Sản phẩm ${item.productId} không tồn tại.`); err.statusCode = 400; throw err;
    }
    if (!prod.isActive || prod.isDeleted) {
      const err = new Error(`Sản phẩm "${prod.name}" không còn bán.`); err.statusCode = 400; throw err;
    }
    const catIds = catIdsBySlug.get(item.slot);
    if (!catIds || !catIds.has(prod.categoryId)) {
      const err = new Error(`Sản phẩm "${prod.name}" không thuộc slot "${item.slot}".`); err.statusCode = 400; throw err;
    }
  }

  return { groupBySlug };
}

export async function saveBuildConfig(rawItems, userId) {
  const { groupBySlug } = await validateSaveItems(rawItems);

  // Generate unique shareCode (up to 5 attempts)
  let shareCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShareCode(8);
    const existing = await prisma.pcBuild.findUnique({ where: { shareCode: candidate }, select: { id: true } });
    if (!existing) { shareCode = candidate; break; }
  }
  if (!shareCode) {
    const err = new Error('Không thể tạo mã chia sẻ. Vui lòng thử lại.'); err.statusCode = 503; throw err;
  }

  await prisma.pcBuild.create({
    data: {
      shareCode,
      ...(userId ? { userId } : {}),
      items: {
        create: rawItems.map(item => ({
          groupId: groupBySlug.get(item.slot).id,
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
    },
  });

  return { shareCode, path: `/customer/build-pc/manual?code=${shareCode}` };
}

// ── Load shared build config ──────────────────────────────────────────────────

const SHARECODE_RE = /^[A-Z2-9]{8}$/;

export async function loadBuildConfig(shareCode) {
  if (!SHARECODE_RE.test(String(shareCode || ''))) {
    const err = new Error('Mã chia sẻ không hợp lệ.'); err.statusCode = 400; throw err;
  }

  const build = await prisma.pcBuild.findUnique({
    where: { shareCode },
    include: {
      items: {
        include: {
          group: { select: { id: true, slug: true } },
          product: {
            select: {
              id: true, name: true, isActive: true, isDeleted: true,
            },
          },
        },
      },
    },
  });

  if (!build) {
    const err = new Error('Không tìm thấy cấu hình.'); err.statusCode = 404; throw err;
  }

  const available = [];
  const unavailable = [];

  for (const item of build.items) {
    const prod = item.product;
    if (!prod.isActive || prod.isDeleted) {
      unavailable.push({
        slot: item.group.slug,
        productName: prod.name,
        reason: prod.isDeleted ? 'đã xóa' : 'ngừng bán',
      });
    } else {
      available.push({ slot: item.group.slug, productId: item.product.id, quantity: item.quantity });
    }
  }

  if (available.length === 0) {
    return {
      data: {
        shareCode: build.shareCode,
        createdAt: build.createdAt,
        items: [],
        unavailable,
        total: 0,
        issues: [],
        missing: [],
        canAddToCart: false,
      isComplete: false,
      },
      meta: {},
      message: 'OK',
    };
  }

  // Reuse validateBuildConfig for compat, pricing, and missing checks
  const validateResult = await validateBuildConfig(available);
  const { items, total, issues, missing, canAddToCart, isComplete } = validateResult.data;

  return {
    data: {
      shareCode: build.shareCode,
      createdAt: build.createdAt,
      items,
      unavailable,
      total,
      issues,
      missing,
      canAddToCart,
      isComplete,
    },
    meta: {},
    message: 'OK',
  };
}
