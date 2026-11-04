// Support Ticket service — MySQL is source of truth.
// Gmail notification is handled separately (supportNotification.service.js).

import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';

// ─── Ticket code ──────────────────────────────────────────────────────────────

function generateCode() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
  return `HT-${ymd}-${rand}`;
}

// ─── Public: create ticket ────────────────────────────────────────────────────

export async function createTicket({ guestName, guestPhone, guestEmail, category, detail, userId, ipAddress }) {
  let code;
  let attempts = 0;
  // Retry loop — collision probability is negligible but handle defensively
  while (true) {
    code = generateCode();
    const existing = await prisma.supportTicket.findUnique({ where: { code } });
    if (!existing) break;
    if (++attempts > 5) throw new Error('Không thể tạo mã phiếu. Vui lòng thử lại.');
  }

  const accessToken = randomUUID();

  const ticket = await prisma.supportTicket.create({
    data: {
      code,
      guestName: guestName.trim(),
      guestPhone: guestPhone.trim(),
      guestEmail: guestEmail?.trim() || null,
      category,
      userId: userId || null,
      accessToken,
      ipAddress: ipAddress || null,
      status: 'WAITING_ADMIN',
    },
  });

  // Create initial customer message
  await prisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      sender: 'CUSTOMER',
      senderName: guestName.trim(),
      body: detail.trim(),
    },
  });

  return ticket;
}

// ─── Get ticket by code + access token (guest) ───────────────────────────────

export async function getTicketByCodeAndToken(code, accessToken) {
  return prisma.supportTicket.findFirst({
    where: { code, accessToken },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
}

// ─── Get ticket for logged-in user ───────────────────────────────────────────

export async function getCustomerTicket(ticketId, userId) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  return ticket;
}

export async function listCustomerTickets(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.supportTicket.count({ where: { userId } }),
    prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, code: true, guestName: true, category: true,
        status: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
  ]);
  return { total, page, limit, items };
}

// ─── Add message (customer) ───────────────────────────────────────────────────

export async function addCustomerMessage(ticketId, { body, senderName, accessToken, userId }) {
  // Verify ownership
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, accessToken: true, status: true },
  });
  if (!ticket) return null;

  const isOwner = userId ? ticket.userId === userId : ticket.accessToken === accessToken;
  if (!isOwner) return null;
  if (ticket.status === 'CLOSED') throw new Error('Phiếu đã đóng, không thể thêm tin nhắn.');

  const message = await prisma.supportMessage.create({
    data: {
      ticketId,
      sender: 'CUSTOMER',
      senderName: senderName?.trim() || 'Khách hàng',
      body: body.trim(),
    },
  });

  // Customer reply → always move back to WAITING_ADMIN
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: 'WAITING_ADMIN', updatedAt: new Date() },
  });

  return message;
}

// ─── Admin: list tickets ──────────────────────────────────────────────────────

export async function listAdminTickets({
  page = 1, limit = 20, status, category, q, assignedAdminId,
} = {}) {
  const skip = (page - 1) * limit;

  const where = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (assignedAdminId === 'me') {
    where.assignedAdminId = { not: null };
  } else if (assignedAdminId) {
    where.assignedAdminId = parseInt(assignedAdminId);
  }
  if (q) {
    const qs = q.trim();
    where.OR = [
      { code: { contains: qs } },
      { guestName: { contains: qs } },
      { guestEmail: { contains: qs } },
      { guestPhone: { contains: qs } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, code: true, guestName: true, guestPhone: true, guestEmail: true,
        category: true, status: true, assignedAdminId: true,
        createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
  ]);

  return { total, page, limit, items };
}

export async function getAdminTicketStats() {
  const counts = await prisma.supportTicket.groupBy({
    by: ['status'],
    _count: { status: true },
  });
  const result = { NEW: 0, IN_PROGRESS: 0, WAITING_ADMIN: 0, WAITING_CUSTOMER: 0, RESOLVED: 0, CLOSED: 0, total: 0 };
  for (const row of counts) {
    result[row.status] = row._count.status;
    result.total += row._count.status;
  }
  return result;
}

// ─── Admin: get ticket detail ─────────────────────────────────────────────────

export async function getAdminTicket(id) {
  return prisma.supportTicket.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      notifications: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, attempts: true, sentAt: true, lastError: true, idempotencyKey: true },
      },
    },
  });
}

// ─── Admin: add reply message ─────────────────────────────────────────────────

export async function addAdminMessage(ticketId, { body, adminId, adminName }) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true },
  });
  if (!ticket) return null;
  if (ticket.status === 'CLOSED') throw new Error('Phiếu đã đóng.');

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId,
        sender: 'ADMIN',
        senderName: adminName || 'Admin',
        adminId: adminId || null,
        body: body.trim(),
      },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'WAITING_CUSTOMER', updatedAt: new Date() },
    }),
  ]);

  return message;
}

// ─── Admin: update status ─────────────────────────────────────────────────────

export async function updateTicketStatus(id, status, adminId) {
  const data = { status };
  if (status === 'CLOSED' || status === 'RESOLVED') data.closedAt = new Date();
  return prisma.supportTicket.update({ where: { id }, data });
}

// ─── Admin: assign ────────────────────────────────────────────────────────────

export async function assignTicket(id, assignedAdminId) {
  return prisma.supportTicket.update({ where: { id }, data: { assignedAdminId } });
}
