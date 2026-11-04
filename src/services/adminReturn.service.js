import { prisma } from '../config/prisma.js';

const VALID_TRANSITIONS = {
  PENDING:   ['APPROVED', 'REJECTED'],
  APPROVED:  ['COMPLETED'],
  REJECTED:  [],
  COMPLETED: [],
};

const returnSelect = {
  id: true, orderId: true, userId: true, reason: true, status: true,
  adminNote: true, createdAt: true, updatedAt: true,
  order: {
    select: {
      id: true, status: true, subtotal: true, shippingName: true, shippingPhone: true, shippingAddress: true,
      items: { select: { id: true, name: true, quantity: true, price: true, primaryImage: true, slug: true } },
    },
  },
  user: { select: { id: true, fullName: true, email: true, phone: true } },
};

export async function listReturns({ page = 1, limit = 20, status, search } = {}) {
  const where = {};
  if (status) where.status = status;
  if (search) {
    const idNum = parseInt(search);
    where.OR = [
      ...(idNum > 0 ? [{ id: idNum }, { orderId: idNum }] : []),
      { user: { OR: [{ fullName: { contains: search } }, { email: { contains: search } }] } },
    ];
  }

  const [returns, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where, select: returnSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit, take: limit,
    }),
    prisma.returnRequest.count({ where }),
  ]);
  return { returns, total, page, limit };
}

export async function getReturn(id) {
  return prisma.returnRequest.findUnique({ where: { id }, select: returnSelect });
}

export async function updateReturnStatus(id, { status, adminNote }) {
  const ret = await prisma.returnRequest.findUnique({ where: { id } });
  if (!ret) { const e = new Error('Yêu cầu đổi trả không tồn tại.'); e.statusCode = 404; throw e; }

  const allowed = VALID_TRANSITIONS[ret.status] ?? [];
  if (!allowed.includes(status)) {
    const e = new Error(`Không thể chuyển từ ${ret.status} sang ${status}.`);
    e.statusCode = 400; throw e;
  }

  return prisma.returnRequest.update({
    where: { id },
    data: { status, adminNote: adminNote?.trim() || null },
    select: returnSelect,
  });
}
