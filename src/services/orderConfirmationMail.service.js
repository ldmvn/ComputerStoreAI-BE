// Order confirmation email, sent to the customer right after an order is placed.
// Reuses the SMTP transport of the OTP / support mails. The order is already committed
// when this runs, so any failure here is logged and never propagates to the checkout request.

import { prisma } from '../config/prisma.js';
import { getResetMailTransport } from './passwordResetMail.service.js';
import { getSetting } from './storeSetting.service.js';

const BRAND_COLOR = '#C4480A';
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;
// Network-level SMTP failures worth one more try; auth/recipient/config errors are permanent.
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ESOCKET', 'EDNS', 'EAI_AGAIN']);

const PAYMENT_LABEL = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng (VietQR)',
  MOMO: 'Ví MoMo',
  VNPAY: 'VNPAY',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatVnd(value) {
  return `${(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function formatTime(value) {
  return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function baseUrl(frontendUrl) {
  return String(frontendUrl || 'http://localhost:3000').replace(/\/+$/, '');
}

function assetUrl(path, frontendUrl) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl(frontendUrl)}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function orderTotal(order) {
  return Math.max(0, (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0));
}

function paymentSection(order, orderUrl) {
  const method = order.paymentMethod;
  const attempt = order.payment?.attempts?.[0];
  const label = PAYMENT_LABEL[method] || escapeHtml(method);
  const total = formatVnd(orderTotal(order));
  let note;
  let text;

  if (method === 'COD') {
    note = `Bạn thanh toán <strong>${total}</strong> cho nhân viên giao hàng khi nhận hàng.`;
    text = `Bạn thanh toán ${total} cho nhân viên giao hàng khi nhận hàng.`;
  } else if (method === 'BANK_TRANSFER') {
    note = 'Đơn hàng <strong>chưa được thanh toán</strong>. Vui lòng chuyển khoản theo thông tin bên dưới để chúng tôi xử lý đơn.';
    text = 'Đơn hàng chưa được thanh toán. Vui lòng chuyển khoản theo thông tin dưới đây để chúng tôi xử lý đơn.';
    if (attempt?.bankAccountNumber) {
      const rows = [
        ['Ngân hàng', attempt.bankName],
        ['Số tài khoản', attempt.bankAccountNumber],
        ['Chủ tài khoản', attempt.bankAccountName],
        ['Số tiền', total],
        ['Nội dung chuyển khoản', attempt.transferContent],
      ].filter(([, v]) => v);
      note += '<table style="margin-top:12px;border-collapse:collapse;font-size:14px">'
        + rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600;color:#0f172a">${escapeHtml(v)}</td></tr>`).join('')
        + '</table><p style="margin:10px 0 0;font-size:13px;color:#64748b">Vui lòng nhập đúng nội dung chuyển khoản để đơn được xác nhận tự động.</p>';
      text += '\n' + rows.map(([k, v]) => `  ${k}: ${v}`).join('\n');
    }
  } else {
    note = `Đơn hàng <strong>chưa được thanh toán</strong>. Vui lòng hoàn tất thanh toán trực tuyến tại trang đơn hàng.`;
    text = `Đơn hàng chưa được thanh toán. Vui lòng hoàn tất thanh toán tại: ${orderUrl}`;
  }
  return { label, note, text };
}

export function buildOrderConfirmationEmail(order, { customerName, senderName = 'DUCMANH PC', frontendUrl } = {}) {
  const orderUrl = `${baseUrl(frontendUrl)}/customer/orders/${order.id}`;
  const name = customerName || order.shippingName || 'Quý khách';
  const total = orderTotal(order);
  const discount = Number(order.discountAmount) || 0;
  const pay = paymentSection(order, orderUrl);
  const items = order.items ?? [];

  const itemRows = items.map(item => {
    const img = assetUrl(item.primaryImage, frontendUrl);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;width:56px">${img ? `<img src="${escapeHtml(img)}" alt="" width="48" height="48" style="display:block;border-radius:6px;object-fit:contain;background:#f8fafc">` : ''}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">${escapeHtml(item.name)}<div style="font-size:12px;color:#64748b">${formatVnd(item.price)} × ${Number(item.quantity) || 0}</div></td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:600;color:#0f172a;white-space:nowrap">${formatVnd((Number(item.price) || 0) * (Number(item.quantity) || 0))}</td>
    </tr>`;
  }).join('');

  const subject = `[${senderName}] Xác nhận đơn hàng #${order.id}`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
  <div style="background:${BRAND_COLOR};padding:18px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">${escapeHtml(senderName)} — Xác nhận đơn hàng</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
    <p style="margin:0 0 12px">Xin chào <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px;color:#475569">Cảm ơn bạn đã đặt hàng. Chúng tôi đã ghi nhận đơn hàng <strong>#${order.id}</strong> lúc ${escapeHtml(formatTime(order.createdAt))}.</p>

    <h3 style="margin:20px 0 4px;font-size:15px">Sản phẩm</h3>
    <table style="width:100%;border-collapse:collapse">${itemRows}</table>
    <table style="width:100%;margin-top:12px;font-size:14px">
      ${discount > 0 ? `<tr><td style="color:#64748b">Tạm tính</td><td style="text-align:right">${formatVnd(order.subtotal)}</td></tr><tr><td style="color:#64748b">Giảm giá</td><td style="text-align:right;color:#059669">-${formatVnd(discount)}</td></tr>` : ''}
      <tr><td style="font-weight:700;padding-top:6px">Tổng thanh toán</td><td style="text-align:right;font-weight:700;font-size:16px;color:${BRAND_COLOR};padding-top:6px">${formatVnd(total)}</td></tr>
    </table>

    <h3 style="margin:24px 0 4px;font-size:15px">Giao hàng</h3>
    <p style="margin:0;font-size:14px;color:#334155">${escapeHtml(order.shippingName)} · ${escapeHtml(order.shippingPhone)}<br>${escapeHtml(order.shippingAddress)}</p>
    ${order.note ? `<p style="margin:8px 0 0;font-size:13px;color:#64748b">Ghi chú: ${escapeHtml(order.note)}</p>` : ''}

    <h3 style="margin:24px 0 4px;font-size:15px">Thanh toán — ${pay.label}</h3>
    <div style="background:#f8fafc;border-left:3px solid ${BRAND_COLOR};padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;color:#334155">${pay.note}</div>

    <p style="margin:24px 0 0"><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Xem đơn hàng →</a></p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">
    <p style="font-size:12px;color:#94a3b8;margin:0">Email tự động từ ${escapeHtml(senderName)}. Nếu bạn không thực hiện đơn hàng này, vui lòng liên hệ cửa hàng.</p>
  </div>
</div>`;

  const text = [
    `Xin chào ${name},`,
    '',
    `Cảm ơn bạn đã đặt hàng. Chúng tôi đã ghi nhận đơn hàng #${order.id} lúc ${formatTime(order.createdAt)}.`,
    '',
    'SẢN PHẨM',
    ...items.map(i => `- ${i.name} (${formatVnd(i.price)} x ${i.quantity}) = ${formatVnd((Number(i.price) || 0) * (Number(i.quantity) || 0))}`),
    ...(discount > 0 ? [`Tạm tính: ${formatVnd(order.subtotal)}`, `Giảm giá: -${formatVnd(discount)}`] : []),
    `Tổng thanh toán: ${formatVnd(total)}`,
    '',
    'GIAO HÀNG',
    `${order.shippingName} - ${order.shippingPhone}`,
    order.shippingAddress,
    ...(order.note ? [`Ghi chú: ${order.note}`] : []),
    '',
    `THANH TOÁN: ${pay.label}`,
    pay.text,
    '',
    `Xem đơn hàng: ${orderUrl}`,
  ].join('\n');

  return { subject, html, text };
}

const _sent = new Set();
function claim(orderId) {
  if (_sent.has(orderId)) return false;
  _sent.add(orderId);
  if (_sent.size > 500) _sent.delete(_sent.values().next().value);
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function sendOrderConfirmation(order, { transport, customer } = {}) {
  if (!order?.id) return { skipped: true, reason: 'no_order' };
  if (!claim(order.id)) return { skipped: true, reason: 'duplicate' };

  const user = customer ?? await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true, fullName: true } });
  if (!user?.email) return { skipped: true, reason: 'no_email' };

  let mailTransport;
  try { mailTransport = transport ?? getResetMailTransport(); }
  catch (e) {
    _sent.delete(order.id);
    console.warn('[OrderMail] Bỏ qua — SMTP chưa cấu hình:', e.message);
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  const senderName = (await getSetting('contact.sender_name').catch(() => null)) || 'DUCMANH PC';
  const { subject, html, text } = buildOrderConfirmationEmail(order, {
    customerName: user.fullName, senderName, frontendUrl: process.env.FRONTEND_URL,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await mailTransport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject, text, html });
      if (!info.accepted?.length) throw Object.assign(new Error('SMTP không chấp nhận người nhận.'), { code: 'SMTP_RECIPIENT_REJECTED' });
      console.info(`[OrderMail] Đã gửi email xác nhận đơn #${order.id}.`);
      return { sent: true };
    } catch (e) {
      const retryable = TRANSIENT_CODES.has(e.code);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        _sent.delete(order.id);
        console.error(`[OrderMail] Gửi email đơn #${order.id} thất bại (${e.code || 'SMTP_ERROR'})${attempt > 1 ? ` sau ${attempt} lần` : ''}.`);
        return { sent: false, error: e.code || 'SMTP_ERROR' };
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}
