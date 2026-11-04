import { prisma } from '../config/prisma.js';

const ALLOWED_SORTS = { name: 'p.name ASC', stock_asc: 'p.stockQuantity ASC', stock_desc: 'p.stockQuantity DESC', updated: 'p.updatedAt DESC' };
const ALLOWED_STATUSES = new Set(['out', 'low', 'in']);
const ALLOWED_LOG_TYPES = new Set(['IMPORT', 'ADJUSTMENT', 'ORDER_DEDUCT', 'RETURN_RESTORE']);

export async function getStats() {
  const [r] = await prisma.$queryRaw`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN stockQuantity <= 0 THEN 1 ELSE 0 END) as outOfStock,
      SUM(CASE WHEN stockQuantity > 0 AND stockQuantity <= lowStockThreshold THEN 1 ELSE 0 END) as lowStock,
      SUM(CASE WHEN stockQuantity > lowStockThreshold THEN 1 ELSE 0 END) as inStock
    FROM Product WHERE isDeleted = 0
  `;
  return {
    total: Number(r.total),
    inStock: Number(r.inStock),
    lowStock: Number(r.lowStock),
    outOfStock: Number(r.outOfStock),
  };
}

export async function listInventory({ page = 1, limit = 20, status, search, sort = 'name' } = {}) {
  const orderBy = ALLOWED_SORTS[sort] || ALLOWED_SORTS.name;
  const offset = (page - 1) * limit;
  const whereParts = ['p.isDeleted = 0'];
  const params = [];

  if (search) {
    whereParts.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (ALLOWED_STATUSES.has(status)) {
    if (status === 'out') whereParts.push('p.stockQuantity <= 0');
    else if (status === 'low') whereParts.push('p.stockQuantity > 0 AND p.stockQuantity <= p.lowStockThreshold');
    else if (status === 'in') whereParts.push('p.stockQuantity > p.lowStockThreshold');
  }

  const where = whereParts.join(' AND ');

  const [products, countRows] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT p.id, p.name, p.sku, p.stockQuantity, p.lowStockThreshold, p.price, p.isActive,
        CASE WHEN p.stockQuantity <= 0 THEN 'out'
             WHEN p.stockQuantity <= p.lowStockThreshold THEN 'low'
             ELSE 'in' END AS stockStatus,
        (SELECT pi.imageUrl FROM ProductImage pi WHERE pi.productId = p.id AND pi.isPrimary = 1 LIMIT 1) AS primaryImage
      FROM Product p
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, ...params, limit, offset),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total FROM Product p WHERE ${where}`,
      ...params
    ),
  ]);

  return { products, total: Number(countRows[0].total), page, limit };
}

export async function importStock(productId, { quantity, reference, note }, adminId) {
  const qty = parseInt(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
    const err = new Error('Số lượng nhập phải từ 1 đến 100,000.'); err.statusCode = 400; throw err;
  }
  const product = await prisma.product.findFirst({ where: { id: productId, isDeleted: false }, select: { id: true, name: true, stockQuantity: true } });
  if (!product) { const err = new Error('Sản phẩm không tồn tại.'); err.statusCode = 404; throw err; }

  return prisma.$transaction(async (tx) => {
    const before = product.stockQuantity;
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stockQuantity: { increment: qty } },
      select: { id: true, name: true, sku: true, stockQuantity: true, lowStockThreshold: true },
    });
    await tx.inventoryLog.create({
      data: {
        productId,
        type: 'IMPORT',
        quantityBefore: before,
        quantityChange: qty,
        quantityAfter: before + qty,
        reference: reference?.trim() || null,
        note: note?.trim() || null,
        adminId,
      },
    });
    return { product: updated };
  });
}

export async function adjustStock(productId, { mode, value, reason }, adminId) {
  if (!['set', 'delta'].includes(mode)) {
    const err = new Error('mode phải là "set" hoặc "delta".'); err.statusCode = 400; throw err;
  }
  const val = parseInt(value);
  if (!Number.isInteger(val)) {
    const err = new Error('Giá trị không hợp lệ.'); err.statusCode = 400; throw err;
  }
  if (!reason?.trim()) {
    const err = new Error('Vui lòng nhập lý do điều chỉnh.'); err.statusCode = 400; throw err;
  }

  const product = await prisma.product.findFirst({ where: { id: productId, isDeleted: false }, select: { id: true, name: true, stockQuantity: true } });
  if (!product) { const err = new Error('Sản phẩm không tồn tại.'); err.statusCode = 404; throw err; }

  const before = product.stockQuantity;
  const after = mode === 'set' ? val : before + val;

  if (after < 0) {
    const err = new Error('Tồn kho sau điều chỉnh không được âm.'); err.statusCode = 400; throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stockQuantity: after },
      select: { id: true, name: true, sku: true, stockQuantity: true, lowStockThreshold: true },
    });
    await tx.inventoryLog.create({
      data: {
        productId,
        type: 'ADJUSTMENT',
        quantityBefore: before,
        quantityChange: after - before,
        quantityAfter: after,
        note: reason.trim(),
        adminId,
      },
    });
    return { product: updated, before, after };
  });
}

export async function listLogs({ page = 1, limit = 30, productId, type, from, to } = {}) {
  const where = {};
  if (productId) where.productId = productId;
  if (type && ALLOWED_LOG_TYPES.has(type)) where.type = type;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    prisma.inventoryLog.findMany({
      where,
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryLog.count({ where }),
  ]);

  return { logs, total, page, limit };
}
