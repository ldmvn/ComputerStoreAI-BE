// Admin support ticket controller — RBAC-protected.

import * as svc from '../services/support.service.js';
import { tryNotifyAfterReply, retryNotification } from '../services/supportNotification.service.js';
import { logActivity } from '../services/activityLog.service.js';

const VALID_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim();
}

// GET /api/admin/support-tickets/stats
export async function getStats(req, res) {
  try {
    const stats = await svc.getAdminTicketStats();
    return res.json({ success: true, data: stats });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// GET /api/admin/support-tickets
export async function listTickets(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { status, category, q, assignedAdminId } = req.query;

    const result = await svc.listAdminTickets({
      page, limit,
      status: status && VALID_STATUSES.includes(status) ? status : undefined,
      category: category ? String(category) : undefined,
      q: q ? String(q).slice(0, 100) : undefined,
      assignedAdminId: assignedAdminId ? String(assignedAdminId) : undefined,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// GET /api/admin/support-tickets/:id
export async function getTicket(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const ticket = await svc.getAdminTicket(id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu.' });

    return res.json({ success: true, data: ticket });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/admin/support-tickets/:id/messages — Admin reply
export async function addAdminReply(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const body = sanitize(req.body.body || '');
    if (!body || body.length < 2) {
      return res.status(422).json({ success: false, message: 'Nội dung không được để trống.' });
    }
    if (body.length > 5000) {
      return res.status(422).json({ success: false, message: 'Nội dung tối đa 5000 ký tự.' });
    }

    const message = await svc.addAdminMessage(id, {
      body,
      adminId:   req.user.userId,
      adminName: req.user.fullName || req.user.email || 'Admin',
    });

    if (!message) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu.' });
    }

    await logActivity({
      req,
      userId: req.user.userId,
      action: 'reply',
      module: 'support',
      targetId: String(id),
      description: `Phản hồi phiếu #${id}`,
      success: true,
    }).catch(() => {});

    // Fire-and-forget Gmail notification
    tryNotifyAfterReply(id, message.id);

    return res.status(201).json({ success: true, data: message, newStatus: 'WAITING_CUSTOMER' });
  } catch (e) {
    if (e.message.includes('đóng')) {
      return res.status(409).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}

// PATCH /api/admin/support-tickets/:id/status
export async function updateStatus(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: 'Trạng thái không hợp lệ.' });
    }

    const ticket = await svc.updateTicketStatus(id, status, req.user.userId);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu.' });

    await logActivity({
      req,
      userId: req.user.userId,
      action: 'update',
      module: 'support',
      targetId: String(id),
      description: `Cập nhật trạng thái phiếu #${id} → ${status}`,
      success: true,
    }).catch(() => {});

    return res.json({ success: true, data: ticket });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// PATCH /api/admin/support-tickets/:id/assign
export async function assignTicket(req, res) {
  try {
    const id = parseInt(req.params.id);
    const assignedAdminId = req.body.assignedAdminId ? parseInt(req.body.assignedAdminId) : null;
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const ticket = await svc.assignTicket(id, assignedAdminId);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu.' });

    await logActivity({
      req,
      userId: req.user.userId,
      action: 'assign',
      module: 'support',
      targetId: String(id),
      description: `Phân công phiếu #${id} → adminId=${assignedAdminId}`,
      success: true,
    }).catch(() => {});

    return res.json({ success: true, data: ticket });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/admin/support-tickets/:id/notify  — retry email
export async function retryNotify(req, res) {
  try {
    const ticketId  = parseInt(req.params.id);
    const messageId = parseInt(req.body.messageId);
    if (!ticketId || !messageId) {
      return res.status(400).json({ success: false, message: 'Cần ticketId và messageId.' });
    }

    const result = await retryNotification(ticketId, messageId);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
