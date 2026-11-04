import { prisma } from '../config/prisma.js';

function voucherStatus(v) {
  const now = new Date();
  if (!v.isActive) return 'disabled';
  if (v.startAt && v.startAt > now) return 'upcoming';
  if (v.endAt && v.endAt < now) return 'expired';
  if (v.usageLimit !== null && v.usageCount >= v.usageLimit) return 'exhausted';
  return 'active';
}

function withStatus(v) {
  return { ...v, status: voucherStatus(v) };
}

export async function getStats() {
  const now = new Date();
  const [total, active, upcoming, expired, disabled] = await Promise.all([
    prisma.voucher.count(),
    prisma.voucher.count({ where: { isActive: true, OR: [{ startAt: null }, { startAt: { lte: now } }], AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }] } }),
    prisma.voucher.count({ where: { isActive: true, startAt: { gt: now } } }),
    prisma.voucher.count({ where: { endAt: { lt: now } } }),
    prisma.voucher.count({ where: { isActive: false } }),
  ]);
  const totalUsage = await prisma.voucherUsage.count();
  const totalDiscount = await prisma.voucherUsage.aggregate({ _sum: { discountAmount: true } });
  return { total, active, upcoming, expired, disabled, totalUsage, totalDiscount: totalDiscount._sum.discountAmount ?? 0 };
}

export async function listVouchers({ page = 1, limit = 20, search, status } = {}) {
  const now = new Date();
  const where = {};
  if (search) {
    where.OR = [{ code: { contains: search } }, { name: { contains: search } }];
  }
  if (status === 'active') {
    where.isActive = true;
    where.AND = [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }, { OR: [{ endAt: null }, { endAt: { gt: now } }] }];
  } else if (status === 'upcoming') {
    where.isActive = true;
    where.startAt = { gt: now };
  } else if (status === 'expired') {
    where.endAt = { lt: now };
  } else if (status === 'disabled') {
    where.isActive = false;
  }

  const [vouchers, total] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.voucher.count({ where }),
  ]);

  return { vouchers: vouchers.map(withStatus), total, page, limit };
}

export async function getVoucher(id) {
  const v = await prisma.voucher.findUnique({ where: { id } });
  if (!v) { const e = new Error('Voucher không tồn tại.'); e.statusCode = 404; throw e; }
  return withStatus(v);
}

function validateInput({ code, name, type, value, maxDiscount, minOrderAmount, startAt, endAt, usageLimit }) {
  if (!code?.trim()) throw Object.assign(new Error('Mã voucher không được trống.'), { statusCode: 400 });
  if (!/^[A-Z0-9_-]{3,50}$/i.test(code.trim())) throw Object.assign(new Error('Mã voucher chỉ gồm chữ cái, số, - và _ (3–50 ký tự).'), { statusCode: 400 });
  if (!name?.trim()) throw Object.assign(new Error('Tên chương trình không được trống.'), { statusCode: 400 });
  if (!['PERCENT', 'FIXED'].includes(type)) throw Object.assign(new Error('Loại giảm giá không hợp lệ.'), { statusCode: 400 });
  const val = parseInt(value);
  if (!Number.isInteger(val) || val <= 0) throw Object.assign(new Error('Giá trị giảm phải lớn hơn 0.'), { statusCode: 400 });
  if (type === 'PERCENT' && val > 100) throw Object.assign(new Error('Giảm theo % không được vượt quá 100.'), { statusCode: 400 });
  if (startAt && endAt && new Date(startAt) >= new Date(endAt)) throw Object.assign(new Error('Thời gian kết thúc phải sau thời gian bắt đầu.'), { statusCode: 400 });
  return {
    code: code.trim().toUpperCase(),
    name: name.trim(),
    type,
    value: val,
    maxDiscount: maxDiscount ? parseInt(maxDiscount) : null,
    minOrderAmount: minOrderAmount ? Math.max(0, parseInt(minOrderAmount)) : 0,
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
    usageLimit: usageLimit ? parseInt(usageLimit) : null,
  };
}

export async function createVoucher(data) {
  const clean = validateInput(data);
  const existing = await prisma.voucher.findUnique({ where: { code: clean.code } });
  if (existing) throw Object.assign(new Error('Mã voucher đã tồn tại.'), { statusCode: 409 });
  const v = await prisma.voucher.create({ data: clean });
  return withStatus(v);
}

export async function updateVoucher(id, data) {
  const existing = await prisma.voucher.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error('Voucher không tồn tại.'), { statusCode: 404 });
  const clean = validateInput({ ...existing, ...data });
  // If code changed, check for duplicate
  if (clean.code !== existing.code) {
    const dup = await prisma.voucher.findUnique({ where: { code: clean.code } });
    if (dup) throw Object.assign(new Error('Mã voucher đã tồn tại.'), { statusCode: 409 });
  }
  const v = await prisma.voucher.update({ where: { id }, data: clean });
  return withStatus(v);
}

export async function toggleActive(id, isActive) {
  const existing = await prisma.voucher.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error('Voucher không tồn tại.'), { statusCode: 404 });
  const v = await prisma.voucher.update({ where: { id }, data: { isActive } });
  return withStatus(v);
}

export async function deleteVoucher(id) {
  const existing = await prisma.voucher.findUnique({ where: { id }, include: { _count: { select: { usages: true } } } });
  if (!existing) throw Object.assign(new Error('Voucher không tồn tại.'), { statusCode: 404 });
  if (existing._count.usages > 0) {
    throw Object.assign(new Error('Không thể xóa voucher đã có lượt sử dụng. Hãy tắt thay vì xóa.'), { statusCode: 409 });
  }
  await prisma.voucher.delete({ where: { id } });
}
