import { prisma } from '../config/prisma.js';
import { validateVoucher, applyVoucherInTx, refundVoucherUsage } from './voucher.service.js';
import { createPaymentForOrder } from '../payments/services/payment.service.js';
import { getSettingsByPrefix } from './storeSetting.service.js';

const ALLOWED_PAYMENT = ['COD', 'BANK_TRANSFER', 'MOMO', 'VNPAY'];

const orderSelect = {
  id: true, userId: true, status: true, paymentMethod: true, note: true,
  shippingName: true, shippingPhone: true, shippingAddress: true,
  subtotal: true, discountAmount: true,
  trackingNumber: true, shippingProvider: true,
  confirmedAt: true, shippedAt: true, deliveredAt: true, cancelledAt: true,
  createdAt: true, updatedAt: true,
  items: {
    select: {
      id: true, productId: true, name: true, slug: true,
      price: true, quantity: true, primaryImage: true,
    },
  },
  payment: {
    select: {
      id: true, method: true, status: true, amount: true, currency: true, paidAt: true,
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true, status: true, merchantReference: true, providerTransactionId: true,
          transferContent: true, bankBin: true, bankName: true,
          bankAccountNumber: true, bankAccountName: true,
          reportedAt: true, paidAt: true, createdAt: true,
        },
      },
    },
  },
};

export async function createOrder(userId, { items, addressId, paymentMethod, note, voucherCode }) {
  if (!ALLOWED_PAYMENT.includes(paymentMethod)) {
    const err = new Error('Phương thức thanh toán không hợp lệ.');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Đơn hàng phải có ít nhất một sản phẩm.');
    err.statusCode = 400;
    throw err;
  }

  const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!address) {
    const err = new Error('Địa chỉ giao hàng không hợp lệ.');
    err.statusCode = 400;
    throw err;
  }

  const productIds = [...new Set(items.map(i => parseInt(i.productId)).filter(id => id > 0))];
  if (productIds.length !== items.length) {
    const err = new Error('Dữ liệu sản phẩm không hợp lệ.');
    err.statusCode = 400;
    throw err;
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true, isDeleted: false },
    select: {
      id: true, name: true, slug: true, price: true, stockQuantity: true,
      images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 },
    },
  });

  if (products.length !== productIds.length) {
    const err = new Error('Một hoặc nhiều sản phẩm không tồn tại hoặc đã ngừng bán.');
    err.statusCode = 422;
    throw err;
  }

  const productMap = new Map(products.map(p => [p.id, p]));

  const orderItems = items.map(({ productId, quantity }) => {
    const pid = parseInt(productId);
    const qty = parseInt(quantity);
    const product = productMap.get(pid);
    if (!product) {
      const err = new Error('Sản phẩm không tồn tại.'); err.statusCode = 422; throw err;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
      const err = new Error('Số lượng không hợp lệ.'); err.statusCode = 400; throw err;
    }
    if (qty > product.stockQuantity) {
      const err = new Error(`Sản phẩm "${product.name}" chỉ còn ${product.stockQuantity} trong kho.`);
      err.statusCode = 422;
      throw err;
    }
    const primaryImage = product.images?.[0]?.imageUrl ?? null;
    return { productId: pid, name: product.name, slug: product.slug, price: product.price, quantity: qty, primaryImage };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingAddress = `${address.streetAddress}, ${address.communeName}, ${address.provinceName}`;

  const orderSettings = await getSettingsByPrefix('order.');
  const minAmount = Number(orderSettings['order.min_amount']) || 0;
  const maxQty = Number(orderSettings['order.max_qty_per_item']) || 0;

  if (minAmount > 0 && subtotal < minAmount) {
    const err = new Error(`Giá trị đơn hàng tối thiểu là ${minAmount.toLocaleString('vi-VN')}₫.`);
    err.statusCode = 400;
    throw err;
  }

  if (maxQty > 0) {
    for (const item of orderItems) {
      if (item.quantity > maxQty) {
        const err = new Error(`Số lượng tối đa mỗi sản phẩm là ${maxQty}. "${item.name}" vượt giới hạn.`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Validate voucher before entering transaction (throws on invalid)
  let voucherInfo = null;
  if (voucherCode?.trim()) {
    voucherInfo = await validateVoucher(voucherCode.trim(), subtotal, userId);
  }

  const discountAmount = voucherInfo?.discountAmount ?? 0;

  return prisma.$transaction(async (tx) => {
    // Re-check stock and capture current quantities
    const stockBefore = new Map();
    for (const item of orderItems) {
      const prod = await tx.product.findFirst({
        where: { id: item.productId, isActive: true, isDeleted: false },
        select: { stockQuantity: true, name: true },
      });
      if (!prod || prod.stockQuantity < item.quantity) {
        const name = prod?.name || item.name;
        const err = new Error(`Sản phẩm "${name}" không đủ số lượng tồn kho.`);
        err.statusCode = 422;
        throw err;
      }
      stockBefore.set(item.productId, prod.stockQuantity);
    }

    // Create order
    const order = await tx.order.create({
      data: {
        userId,
        paymentMethod,
        note: note?.trim() || null,
        shippingName: address.fullName,
        shippingPhone: address.phone,
        shippingAddress,
        subtotal,
        discountAmount,
        items: { create: orderItems },
      },
      select: orderSelect,
    });

    // Apply voucher atomically (re-checks limit inside tx)
    if (voucherInfo) {
      await applyVoucherInTx(tx, voucherInfo.id, order.id, userId, discountAmount);
    }

    // Deduct stock atomically — conditional update prevents race conditions
    // between concurrent transactions that both passed the pre-check above.
    for (const item of orderItems) {
      const before = stockBefore.get(item.productId);
      const result = await tx.product.updateMany({
        where: {
          id: item.productId,
          isActive: true,
          isDeleted: false,
          stockQuantity: { gte: item.quantity },
        },
        data: { stockQuantity: { decrement: item.quantity } },
      });
      if (result.count === 0) {
        const err = new Error(`Sản phẩm "${item.name}" vừa hết hàng, vui lòng thử lại.`);
        err.statusCode = 422;
        throw err;
      }
      await tx.inventoryLog.create({
        data: {
          productId: item.productId,
          type: 'ORDER_DEDUCT',
          quantityBefore: before,
          quantityChange: -item.quantity,
          quantityAfter: before - item.quantity,
          reference: `ĐH #${order.id}`,
        },
      });
    }

    const { payment, attempt } = await createPaymentForOrder(tx, order);

    // Attach payment snapshot so BANK_TRANSFER checkout can show the VietQR
    // popup immediately without a second round-trip. For MOMO/VNPAY the caller
    // triggers a separate /payments/orders/:id/{momo,vnpay} request; the
    // attached payment object is available but not needed there.
    return {
      ...order,
      payment: payment
        ? { ...payment, attempts: attempt ? [attempt] : [] }
        : null,
    };
  });
}

export async function listOrders(userId) {
  return prisma.order.findMany({
    where: { userId },
    select: orderSelect,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getOrder(userId, orderId) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    select: orderSelect,
  });
}

const EDITABLE_PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'CANCELLED', 'FAILED', 'EXPIRED'];

// Address can be changed until the parcel is handed to carrier (SHIPPING).
const ADDRESS_EDITABLE_STATUSES = ['PENDING', 'CONFIRMED'];

function assertNotFound(order) {
  if (!order) { const e = new Error('Đơn hàng không tồn tại.'); e.statusCode = 404; throw e; }
}

function assertAddressEditable(order) {
  assertNotFound(order);
  if (!ADDRESS_EDITABLE_STATUSES.includes(order.status)) {
    const e = new Error('Không thể đổi địa chỉ sau khi đơn hàng đã được bàn giao vận chuyển.');
    e.statusCode = 400; throw e;
  }
}

function assertOrderEditable(order) {
  assertNotFound(order);
  if (order.status !== 'PENDING') { const e = new Error('Chỉ có thể chỉnh sửa đơn hàng đang chờ xử lý.'); e.statusCode = 400; throw e; }
  if (order.payment && !EDITABLE_PAYMENT_STATUSES.includes(order.payment.status)) {
    const e = new Error('Đơn hàng đã thanh toán, không thể chỉnh sửa.'); e.statusCode = 400; throw e;
  }
}

export async function updateOrderAddress(userId, orderId, addressId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, status: true },
  });
  assertAddressEditable(order);

  const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!address) { const e = new Error('Địa chỉ không hợp lệ.'); e.statusCode = 400; throw e; }

  const shippingAddress = `${address.streetAddress}, ${address.communeName}, ${address.provinceName}`;
  return prisma.order.update({
    where: { id: orderId },
    data: {
      shippingName: address.fullName,
      shippingPhone: address.phone,
      shippingAddress,
    },
    select: orderSelect,
  });
}

export async function updateOrderPaymentMethod(userId, orderId, paymentMethod) {
  if (!ALLOWED_PAYMENT.includes(paymentMethod)) {
    const e = new Error('Phương thức thanh toán không hợp lệ.'); e.statusCode = 400; throw e;
  }
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, status: true, paymentMethod: true, payment: { select: { id: true, status: true } } },
  });
  assertOrderEditable(order);

  if (order.paymentMethod === paymentMethod) {
    return prisma.order.findFirst({ where: { id: orderId, userId }, select: orderSelect });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { paymentMethod },
      select: orderSelect,
    });
    if (order.payment) {
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { method: paymentMethod },
      });
    }
    return updated;
  });
}

export async function reorderItems(userId, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId, status: 'CANCELLED' },
    select: { id: true, items: { select: { productId: true, name: true, quantity: true } } },
  });
  if (!order) {
    const err = new Error('Đơn hàng không tồn tại hoặc không thể mua lại.'); err.statusCode = 404; throw err;
  }

  const productIds = order.items.map(i => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, name: true, slug: true, price: true, stockQuantity: true,
      isActive: true, isDeleted: true,
      images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 },
    },
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  const available = [];
  const unavailable = [];

  for (const item of order.items) {
    const p = productMap.get(item.productId);
    if (!p || p.isDeleted || !p.isActive) {
      unavailable.push({ name: item.name, reason: 'Sản phẩm không còn bán' });
      continue;
    }
    if (p.stockQuantity <= 0) {
      unavailable.push({ name: item.name, reason: 'Hết hàng' });
      continue;
    }
    const addedQuantity = Math.min(item.quantity, p.stockQuantity);
    available.push({
      product: {
        id: p.id, name: p.name, slug: p.slug, price: p.price,
        stockQuantity: p.stockQuantity, isActive: p.isActive, isDeleted: p.isDeleted,
        primaryImage: p.images?.[0]?.imageUrl ?? null,
      },
      requestedQuantity: item.quantity,
      addedQuantity,
    });
  }

  return { available, unavailable };
}

export async function cancelOrder(userId, orderId) {
  const where = userId ? { id: orderId, userId } : { id: orderId };
  const order = await prisma.order.findFirst({
    where,
    include: { items: { select: { productId: true, quantity: true } } },
  });
  if (!order) return null;
  if (order.status !== 'PENDING') {
    const err = new Error('Chỉ có thể hủy đơn hàng ở trạng thái chờ xử lý.');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      select: orderSelect,
    });

    for (const item of order.items) {
      const prod = await tx.product.findUnique({
        where: { id: item.productId },
        select: { stockQuantity: true },
      });
      if (prod) {
        const before = prod.stockQuantity;
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: item.quantity } },
        });
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: 'RETURN_RESTORE',
            quantityBefore: before,
            quantityChange: item.quantity,
            quantityAfter: before + item.quantity,
            reference: `ĐH #${orderId}`,
            note: 'Khách hủy đơn hàng',
          },
        });
      }
    }

    // Refund voucher usage count if applicable
    await refundVoucherUsage(tx, orderId);

    return updated;
  });
}

export async function cancelExpiredOrders() {
  const settings = await getSettingsByPrefix('order.');
  const hours = Number(settings['order.auto_cancel_hours']) || 0;
  if (hours <= 0) return 0;

  const cutoff = new Date(Date.now() - hours * 3600_000);
  const expired = await prisma.order.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    select: { id: true },
  });

  let cancelled = 0;
  for (const { id } of expired) {
    try {
      await cancelOrder(null, id);
      cancelled++;
    } catch {
      // skip orders that can't be cancelled
    }
  }
  if (cancelled > 0) console.log(`[AutoCancel] Huỷ ${cancelled} đơn hàng quá hạn.`);
  return cancelled;
}
