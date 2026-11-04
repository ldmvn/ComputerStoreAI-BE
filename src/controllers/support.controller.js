// Public support ticket controller — no auth required.
// Rate limiting and honeypot are applied at the route level.

import * as svc from '../services/support.service.js';
import { logActivity } from '../services/activityLog.service.js';

const VN_PHONE = /^(0[3-9]\d{8}|\+84[3-9]\d{8})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_TEXT = /^[\s\S]{1,2000}$/;

const VALID_CATEGORIES = [
  'Lỗi kỹ thuật sản phẩm',
  'Cài đặt & Phần mềm',
  'Kết nối & Mạng',
  'Linh kiện & Nâng cấp',
  'Khác',
];

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// POST /api/support/tickets
export async function createTicket(req, res) {
  try {
    const {
      name, phone, email, category, detail,
      _honeypot, // honeypot field — must be empty
    } = req.body;

    // Honeypot check
    if (_honeypot) {
      return res.status(200).json({ success: true, data: { fake: true } }); // silent discard
    }

    // Validation
    const errors = {};
    const cleanName = sanitize(name);
    const cleanPhone = sanitize(phone);
    const cleanEmail = email ? sanitize(email) : '';
    const cleanCategory = sanitize(category);
    const cleanDetail = sanitize(detail);

    if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
      errors.name = 'Họ tên phải từ 2–100 ký tự.';
    }
    if (!cleanPhone || !VN_PHONE.test(cleanPhone.replace(/\s/g, ''))) {
      errors.phone = 'Số điện thoại không hợp lệ (VD: 0386220065).';
    }
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
      errors.email = 'Địa chỉ email không hợp lệ.';
    }
    if (!VALID_CATEGORIES.includes(cleanCategory)) {
      errors.category = 'Loại hỗ trợ không hợp lệ.';
    }
    if (!cleanDetail || cleanDetail.length < 10 || cleanDetail.length > 2000) {
      errors.detail = 'Mô tả phải từ 10–2000 ký tự.';
    }

    if (Object.keys(errors).length) {
      return res.status(422).json({ success: false, errors });
    }

    // Create ticket — userId from auth if logged in (optional middleware)
    const userId = req.user?.userId || null;

    const ticket = await svc.createTicket({
      guestName: cleanName,
      guestPhone: cleanPhone,
      guestEmail: cleanEmail || null,
      category: cleanCategory,
      detail: cleanDetail,
      userId,
      ipAddress: req.ip,
    });

    await logActivity({
      req,
      userId,
      action: 'create',
      module: 'support',
      targetId: String(ticket.id),
      targetLabel: ticket.code,
      description: `Phiếu hỗ trợ mới: ${ticket.code} — ${cleanCategory}`,
      success: true,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: {
        id: ticket.id,
        code: ticket.code,
        accessToken: ticket.accessToken,
        // Client stores code+token to allow guest access
      },
    });
  } catch (e) {
    console.error('[Support] createTicket error:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
}

// GET /api/support/ticket?code=HT-...&token=<uuid>
export async function getTicketGuest(req, res) {
  try {
    const { code, token } = req.query;
    if (!code || !token) {
      return res.status(400).json({ success: false, message: 'Cần code và token.' });
    }

    const ticket = await svc.getTicketByCodeAndToken(String(code), String(token));
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu hoặc liên kết không hợp lệ.' });
    }

    return res.json({ success: true, data: ticket });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/support/ticket/:id/messages  (guest reply via accessToken)
export async function addGuestMessage(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

    const { body, accessToken } = req.body;
    if (!body?.trim() || body.trim().length < 2) {
      return res.status(422).json({ success: false, message: 'Nội dung phản hồi không được để trống.' });
    }
    if (!accessToken) {
      return res.status(401).json({ success: false, message: 'Cần accessToken để phản hồi.' });
    }

    const message = await svc.addCustomerMessage(id, {
      body: sanitize(body),
      senderName: req.body.senderName ? sanitize(req.body.senderName) : undefined,
      accessToken: String(accessToken),
      userId: req.user?.userId || null,
    });

    if (!message) {
      return res.status(403).json({ success: false, message: 'Không có quyền truy cập phiếu này.' });
    }

    return res.status(201).json({ success: true, data: message });
  } catch (e) {
    if (e.message.includes('đóng')) {
      return res.status(409).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}
