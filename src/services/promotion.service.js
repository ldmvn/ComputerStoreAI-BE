import { prisma } from '../config/prisma.js';

function err(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

function promotionStatus(p) {
  const now = new Date();
  if (!p.isActive) return 'disabled';
  if (p.startAt && p.startAt > now) return 'upcoming';
  if (p.endAt && p.endAt < now) return 'expired';
  return 'active';
}

function withStatus(p) {
  return { ...p, status: promotionStatus(p) };
}

const activeTimeWhere = now => ({
  isActive: true,
  AND: [
    { OR: [{ startAt: null }, { startAt: { lte: now } }] },
    { OR: [{ endAt: null }, { endAt: { gte: now } }] },
  ],
});

// ─── Admin: stats ───────────────────────────────────────────────────────────

export async function getStats() {
  const now = new Date();
  const [total, active, upcoming, expired, disabled] = await Promise.all([
    prisma.promotion.count(),
    prisma.promotion.count({ where: activeTimeWhere(now) }),
    prisma.promotion.count({ where: { isActive: true, startAt: { gt: now } } }),
    prisma.promotion.count({ where: { endAt: { lt: now } } }),
    prisma.promotion.count({ where: { isActive: false } }),
  ]);
  return { total, active, upcoming, expired, disabled };
}

// ─── Admin: list ────────────────────────────────────────────────────────────

export async function listPromotions({ page = 1, limit = 20, search, status, type, scope } = {}) {
  const now = new Date();
  const where = {};
  if (search?.trim()) {
    where.OR = [{ name: { contains: search.trim() } }, { displayTitle: { contains: search.trim() } }];
  }
  if (status === 'active') Object.assign(where, activeTimeWhere(now));
  else if (status === 'upcoming') { where.isActive = true; where.startAt = { gt: now }; }
  else if (status === 'expired') where.endAt = { lt: now };
  else if (status === 'disabled') where.isActive = false;
  if (type && ['GIFT', 'INFO'].includes(type)) where.type = type;
  if (scope && ['ALL', 'CATEGORY', 'PRODUCT'].includes(scope)) where.scope = scope;

  const [rows, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        giftProduct: { select: { id: true, name: true } },
        _count: { select: { categories: true, products: true } },
      },
    }),
    prisma.promotion.count({ where }),
  ]);

  return { promotions: rows.map(withStatus), total, page, limit };
}

// ─── Admin: detail (includes linked category/product ids for the edit form) ─

export async function getPromotion(id) {
  const p = await prisma.promotion.findUnique({
    where: { id },
    include: {
      giftProduct: { select: { id: true, name: true, price: true } },
      categories: { select: { categoryId: true } },
      products: { select: { productId: true } },
    },
  });
  if (!p) throw err('Chương trình không tồn tại.', 404);
  return {
    ...withStatus(p),
    categoryIds: p.categories.map(c => c.categoryId),
    productIds: p.products.map(pr => pr.productId),
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateInput(data) {
  const { name, displayTitle, description, conditionText, detailUrl, type, scope, sortOrder,
    startAt, endAt, giftProductId, giftProductName, giftQuantity, categoryIds, productIds } = data;

  if (!name?.trim()) throw err('Tên chương trình không được để trống.', 400);
  if (!displayTitle?.trim()) throw err('Tiêu đề hiển thị không được để trống.', 400);
  if (!['GIFT', 'INFO'].includes(type)) throw err('Loại ưu đãi không hợp lệ.', 400);
  if (!['ALL', 'CATEGORY', 'PRODUCT'].includes(scope)) throw err('Phạm vi áp dụng không hợp lệ.', 400);
  if (startAt && endAt && new Date(startAt) >= new Date(endAt)) throw err('Thời gian kết thúc phải sau thời gian bắt đầu.', 400);

  const cleanCategoryIds = Array.isArray(categoryIds) ? [...new Set(categoryIds.map(Number).filter(Number.isInteger))] : [];
  const cleanProductIds = Array.isArray(productIds) ? [...new Set(productIds.map(Number).filter(Number.isInteger))] : [];
  if (scope === 'CATEGORY' && !cleanCategoryIds.length) throw err('Vui lòng chọn ít nhất một danh mục.', 400);
  if (scope === 'PRODUCT' && !cleanProductIds.length) throw err('Vui lòng chọn ít nhất một sản phẩm.', 400);

  let cleanGiftProductId = null;
  let cleanGiftProductName = null;
  let cleanGiftQuantity = null;
  if (type === 'GIFT') {
    cleanGiftProductId = giftProductId ? parseInt(giftProductId) : null;
    cleanGiftProductName = !cleanGiftProductId && giftProductName?.trim() ? giftProductName.trim().slice(0, 191) : null;
    if (!cleanGiftProductId && !cleanGiftProductName) throw err('Vui lòng chọn sản phẩm quà tặng hoặc nhập tên quà thủ công.', 400);
    cleanGiftQuantity = giftQuantity ? Math.max(1, parseInt(giftQuantity)) : null;
  }

  return {
    name: name.trim(), displayTitle: displayTitle.trim(),
    description: description?.trim() || null,
    conditionText: conditionText?.trim() || null,
    detailUrl: detailUrl?.trim() || null,
    type, scope,
    sortOrder: Number.isInteger(parseInt(sortOrder)) ? parseInt(sortOrder) : 0,
    isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
    giftProductId: cleanGiftProductId,
    giftProductName: cleanGiftProductName,
    giftQuantity: cleanGiftQuantity,
    categoryIds: cleanCategoryIds,
    productIds: cleanProductIds,
  };
}

// ─── Admin: create / update ─────────────────────────────────────────────────

export async function createPromotion(data) {
  const clean = validateInput(data);
  const { categoryIds, productIds, ...fields } = clean;
  const created = await prisma.$transaction(async tx => {
    const promotion = await tx.promotion.create({ data: fields });
    if (fields.scope === 'CATEGORY' && categoryIds.length) {
      await tx.promotionCategory.createMany({ data: categoryIds.map(categoryId => ({ promotionId: promotion.id, categoryId })) });
    }
    if (fields.scope === 'PRODUCT' && productIds.length) {
      await tx.promotionProduct.createMany({ data: productIds.map(productId => ({ promotionId: promotion.id, productId })) });
    }
    return promotion;
  });
  return getPromotion(created.id);
}

export async function updatePromotion(id, data) {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw err('Chương trình không tồn tại.', 404);
  const clean = validateInput(data);
  const { categoryIds, productIds, ...fields } = clean;
  await prisma.$transaction(async tx => {
    await tx.promotion.update({ where: { id }, data: fields });
    await tx.promotionCategory.deleteMany({ where: { promotionId: id } });
    await tx.promotionProduct.deleteMany({ where: { promotionId: id } });
    if (fields.scope === 'CATEGORY' && categoryIds.length) {
      await tx.promotionCategory.createMany({ data: categoryIds.map(categoryId => ({ promotionId: id, categoryId })) });
    }
    if (fields.scope === 'PRODUCT' && productIds.length) {
      await tx.promotionProduct.createMany({ data: productIds.map(productId => ({ promotionId: id, productId })) });
    }
  });
  return getPromotion(id);
}

export async function toggleActive(id, isActive) {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw err('Chương trình không tồn tại.', 404);
  await prisma.promotion.update({ where: { id }, data: { isActive } });
  return getPromotion(id);
}

export async function deletePromotion(id) {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw err('Chương trình không tồn tại.', 404);
  await prisma.promotion.delete({ where: { id } });
}

// ─── Admin: pickers ─────────────────────────────────────────────────────────

export async function listCategoriesFlat() {
  return prisma.category.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
  });
}

const promotionProductSelect = {
  id: true, name: true, price: true,
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { imageUrl: true }, take: 1 },
};

export async function searchPromotionProducts(search = '') {
  const normalized = typeof search === 'string' ? search.trim() : '';
  return prisma.product.findMany({
    where: { isDeleted: false, ...(normalized ? { name: { contains: normalized } } : {}) },
    select: promotionProductSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 50,
  });
}

// ─── Public: promotions applicable to a product ─────────────────────────────

// Walks the category tree upward from the product's own category so that a
// promotion scoped to a PARENT category also matches products filed under any
// of its descendant categories (cascade), without materializing descendant
// lists that would go stale if the tree is re-parented later.
async function categoryAncestorIds(categoryId) {
  const ids = [];
  let current = categoryId;
  const seen = new Set();
  for (let depth = 0; current && depth < 10 && !seen.has(current); depth++) {
    seen.add(current);
    ids.push(current);
    const row = await prisma.category.findUnique({ where: { id: current }, select: { parentId: true } });
    current = row?.parentId ?? null;
  }
  return ids;
}

function publicGift(p) {
  if (p.type !== 'GIFT') return null;
  if (p.giftProduct) {
    const image = p.giftProduct.images?.[0]?.imageUrl ?? null;
    return { productId: p.giftProduct.id, name: p.giftProduct.name, price: p.giftProduct.price, imageUrl: image, quantity: p.giftQuantity };
  }
  if (p.giftProductName) return { productId: null, name: p.giftProductName, price: null, imageUrl: null, quantity: p.giftQuantity };
  return null;
}

export async function getActivePromotionsForProduct(productId, categoryId) {
  const now = new Date();
  const ancestorIds = categoryId ? await categoryAncestorIds(categoryId) : [];

  const scopeConditions = [{ scope: 'ALL' }, { scope: 'PRODUCT', products: { some: { productId } } }];
  if (ancestorIds.length) scopeConditions.push({ scope: 'CATEGORY', categories: { some: { categoryId: { in: ancestorIds } } } });

  const rows = await prisma.promotion.findMany({
    where: { ...activeTimeWhere(now), OR: scopeConditions },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      giftProduct: { select: { id: true, name: true, price: true, images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } } } },
    },
  });

  return rows.map(p => ({
    id: p.id,
    type: p.type,
    displayTitle: p.displayTitle,
    description: p.description,
    conditionText: p.conditionText,
    detailUrl: p.detailUrl,
    endAt: p.endAt,
    gift: publicGift(p),
  }));
}
