import { prisma } from '../config/prisma.js';
import { refundVoucherUsage } from './voucher.service.js';
import { cancelPaymentForOrder } from '../payments/services/payment.service.js';

const PAYMENT_SELECT = {
  id: true, method: true, status: true, amount: true, currency: true, paidAt: true,
  attempts: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true, status: true, merchantReference: true, providerTransactionId: true, transferContent: true,
      bankBin: true, bankName: true, bankAccountNumber: true, bankAccountName: true,
      reportedAt: true, paidAt: true, createdAt: true,
    },
  },
};

const VALID_TRANSITIONS = {
  PENDING:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPING', 'CANCELLED'],
  SHIPPING:  ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

// Centralized payment-before-fulfillment rule: an order paid through a
// gateway (bank transfer, or MoMo/VNPAY once wired up) must have a PAID
// Payment before Admin can approve (CONFIRMED) or ship (SHIPPING) it. COD is
// the deliberate exception — it is approved/shipped first, cash is
// confirmed afterwards via adminConfirmCodPayment(). This is the single
// place that enforces it for the regular status-update path; the merged
// VietQR "confirm & approve" action in payment.service.js satisfies it by
// construction (it only reaches the CONFIRMED write after Payment is PAID
// within the same transaction).
const PAYMENT_REQUIRED_METHODS = ['BANK_TRANSFER', 'MOMO', 'VNPAY'];
const PAYMENT_GATED_TARGETS = new Set(['CONFIRMED', 'SHIPPING']);

const orderSelect = {
  id: true, userId: true, status: true, paymentMethod: true, note: true,
  shippingName: true, shippingPhone: true, shippingAddress: true,
  subtotal: true, discountAmount: true, trackingNumber: true, shippingProvider: true,
  confirmedAt: true, shippedAt: true, deliveredAt: true, cancelledAt: true,
  createdAt: true, updatedAt: true,
  user: { select: { id: true, fullName: true, email: true, phone: true } },
  items: {
    select: { id: true, productId: true, name: true, slug: true, price: true, quantity: true, primaryImage: true },
  },
  statusHistory: {
    select: { id: true, status: true, note: true, adminId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  payment: { select: PAYMENT_SELECT },
};

export async function listAllOrders({ page = 1, limit = 20, status, search, paymentMethod, paymentStatus, from, to } = {}) {
  const where = {};
  if (status) where.status = status;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  // Relation filter — requires an actual Payment row with this status, so an
  // old order with no Payment record is correctly excluded rather than
  // assumed to match any status.
  if (paymentStatus) where.payment = { status: paymentStatus };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (search) {
    const idNum = parseInt(search);
    where.OR = [
      ...(idNum > 0 ? [{ id: idNum }] : []),
      { shippingName: { contains: search } },
      { shippingPhone: { contains: search } },
      { user: { OR: [{ fullName: { contains: search } }, { email: { contains: search } }] } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, select: orderSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit, take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, total, page, limit };
}

export async function getAdminOrder(id) {
  return prisma.order.findUnique({ where: { id }, select: orderSelect });
}

export async function updateOrderStatus(id, { status, note, trackingNumber, shippingProvider }, adminId) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) { const e = new Error('Đơn hàng không tồn tại.'); e.statusCode = 404; throw e; }

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    const e = new Error(`Không thể chuyển từ ${order.status} sang ${status}.`);
    e.statusCode = 400; throw e;
  }

  if (PAYMENT_GATED_TARGETS.has(status) && PAYMENT_REQUIRED_METHODS.includes(order.paymentMethod)) {
    const payment = await prisma.payment.findUnique({ where: { orderId: id }, select: { status: true } });
    if (payment?.status !== 'PAID') {
      const e = new Error(`Đơn hàng chưa được xác nhận thanh toán — không thể chuyển sang ${status === 'CONFIRMED' ? 'Đã xác nhận' : 'Đang giao'}.`);
      e.statusCode = 409; e.code = 'PAYMENT_NOT_CONFIRMED'; throw e;
    }
  }

  const now = new Date();
  const timestamps = {
    CONFIRMED: { confirmedAt: now },
    SHIPPING:  { shippedAt: now },
    DELIVERED: { deliveredAt: now },
    CANCELLED: { cancelledAt: now },
  };

  const orderWithItems = status === 'CANCELLED'
    ? await prisma.order.findUnique({ where: { id }, include: { items: { select: { productId: true, quantity: true } } } })
    : null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: {
        status,
        ...(timestamps[status] || {}),
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
        ...(shippingProvider !== undefined ? { shippingProvider } : {}),
      },
      select: orderSelect,
    });
    await tx.orderStatusHistory.create({
      data: { orderId: id, status, note: note?.trim() || null, adminId },
    });

    // Refund voucher usage on admin cancel
    if (status === 'CANCELLED') {
      await refundVoucherUsage(tx, id);
      await cancelPaymentForOrder(tx, id);
      updated.payment = await tx.payment.findUnique({ where: { orderId: id }, select: PAYMENT_SELECT });
    }

    // Restore stock when admin cancels an order
    if (status === 'CANCELLED' && orderWithItems) {
      for (const item of orderWithItems.items) {
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
              reference: `ĐH #${id}`,
              note: 'Admin hủy đơn hàng',
              adminId,
            },
          });
        }
      }
    }

    return updated;
  });
}

export async function updateShipping(id, { trackingNumber, shippingProvider, note }, adminId) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) { const e = new Error('Đơn hàng không tồn tại.'); e.statusCode = 404; throw e; }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: { trackingNumber, shippingProvider },
      select: orderSelect,
    });
    if (note?.trim()) {
      await tx.orderStatusHistory.create({
        data: { orderId: id, status: order.status, note: note.trim(), adminId },
      });
    }
    return updated;
  });
}

export async function getOrderStats({ from, to } = {}) {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [all, byStatus, revenueResult] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ['status'], where, _count: true }),
    prisma.order.aggregate({
      where: { ...where, status: { in: ['DELIVERED'] } },
      _sum: { subtotal: true },
    }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map(s => [s.status, s._count]));
  return {
    total: all,
    pending: statusMap.PENDING ?? 0,
    confirmed: statusMap.CONFIRMED ?? 0,
    shipping: statusMap.SHIPPING ?? 0,
    delivered: statusMap.DELIVERED ?? 0,
    cancelled: statusMap.CANCELLED ?? 0,
    revenue: revenueResult._sum.subtotal ?? 0,
  };
}
