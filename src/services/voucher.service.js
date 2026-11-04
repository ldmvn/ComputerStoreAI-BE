import { prisma } from '../config/prisma.js';

function voucherStatus(v) {
  const now = new Date();
  if (!v.isActive) return 'disabled';
  if (v.startAt && v.startAt > now) return 'upcoming';
  if (v.endAt && v.endAt < now) return 'expired';
  if (v.usageLimit !== null && v.usageCount >= v.usageLimit) return 'exhausted';
  return 'active';
}

export function calcDiscount(voucher, subtotal) {
  if (voucher.type === 'PERCENT') {
    const raw = Math.floor(subtotal * voucher.value / 100);
    return voucher.maxDiscount !== null ? Math.min(raw, voucher.maxDiscount) : raw;
  }
  // FIXED — never exceed subtotal
  return Math.min(voucher.value, subtotal);
}

export async function validateVoucher(code, subtotal, userId) {
  const voucher = await prisma.voucher.findUnique({
    where: { code: code.toUpperCase() },
  });

  if (!voucher) {
    const e = new Error('Mã giảm giá không tồn tại.'); e.statusCode = 404; throw e;
  }

  const status = voucherStatus(voucher);
  if (status === 'disabled') { const e = new Error('Mã giảm giá đã bị tắt.'); e.statusCode = 400; throw e; }
  if (status === 'upcoming') { const e = new Error('Mã giảm giá chưa đến thời gian áp dụng.'); e.statusCode = 400; throw e; }
  if (status === 'expired') { const e = new Error('Mã giảm giá đã hết hạn.'); e.statusCode = 400; throw e; }
  if (status === 'exhausted') { const e = new Error('Mã giảm giá đã hết lượt sử dụng.'); e.statusCode = 400; throw e; }

  if (subtotal < voucher.minOrderAmount) {
    const e = new Error(`Đơn hàng tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')} ₫ để áp dụng mã này.`);
    e.statusCode = 400; throw e;
  }

  const discountAmount = calcDiscount(voucher, subtotal);

  return {
    id: voucher.id,
    code: voucher.code,
    name: voucher.name,
    type: voucher.type,
    value: voucher.value,
    maxDiscount: voucher.maxDiscount,
    discountAmount,
    finalAmount: subtotal - discountAmount,
  };
}

// Called inside a Prisma transaction — applies voucher atomically
export async function applyVoucherInTx(tx, voucherId, orderId, userId, discountAmount) {
  // Re-check limit inside transaction to prevent oversell
  const voucher = await tx.voucher.findUnique({ where: { id: voucherId } });
  if (!voucher || !voucher.isActive) {
    const e = new Error('Mã giảm giá không còn hợp lệ.'); e.statusCode = 422; throw e;
  }
  if (voucher.usageLimit !== null && voucher.usageCount >= voucher.usageLimit) {
    const e = new Error('Mã giảm giá đã hết lượt sử dụng.'); e.statusCode = 422; throw e;
  }
  await tx.voucher.update({ where: { id: voucherId }, data: { usageCount: { increment: 1 } } });
  await tx.voucherUsage.create({ data: { voucherId, orderId, userId, discountAmount } });
}

// Called when order is cancelled — refund usage count
export async function refundVoucherUsage(tx, orderId) {
  const usage = await tx.voucherUsage.findUnique({ where: { orderId } });
  if (!usage) return;
  await tx.voucher.update({ where: { id: usage.voucherId }, data: { usageCount: { decrement: 1 } } });
}
