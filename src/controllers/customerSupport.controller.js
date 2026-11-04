// Customer support controller — requires authenticated (non-admin) user.

import * as svc from '../services/support.service.js';

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim();
}

// GET /api/customer/support/tickets
export async function listMyTickets(req, res) {
  try {
    const userId = req.user.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const result = await svc.listCustomerTickets(userId, { page, limit });
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// GET /api/customer/support/tickets/:id
export async function getMyTicket(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user.userId;
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const ticket = await svc.getCustomerTicket(id, userId);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu.' });

    return res.json({ success: true, data: ticket });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/customer/support/tickets/:id/messages
export async function addMyMessage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user.userId;
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const body = sanitize(req.body.body || '');
    if (!body || body.length < 2) {
      return res.status(422).json({ success: false, message: 'Nội dung không được để trống.' });
    }
    if (body.length > 2000) {
      return res.status(422).json({ success: false, message: 'Nội dung tối đa 2000 ký tự.' });
    }

    const message = await svc.addCustomerMessage(id, {
      body,
      senderName: req.user.fullName || req.user.email,
      userId,
    });

    if (!message) {
      return res.status(403).json({ success: false, message: 'Không có quyền truy cập phiếu này.' });
    }

    return res.status(201).json({ success: true, data: message, newStatus: 'WAITING_ADMIN' });
  } catch (e) {
    if (e.message.includes('đóng')) {
      return res.status(409).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}
