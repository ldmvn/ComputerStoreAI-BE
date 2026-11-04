// Support email notification via SMTP (same transport as OTP/password reset).
// MySQL is source of truth — notifications are fire-and-forget with idempotency.
// Caller saves ticket/message BEFORE calling this; SMTP failure never aborts a reply.

import { prisma } from '../config/prisma.js';
import { getResetMailTransport } from './passwordResetMail.service.js';
import { getSetting } from './storeSetting.service.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function buildIdempotencyKey(ticketId, messageId) {
  return `support-reply-t${ticketId}-m${messageId}`;
}

function buildEmailContent(ticket, message, senderName) {
  const accessLink = `${FRONTEND_URL}/support/ticket?code=${encodeURIComponent(ticket.code)}&token=${encodeURIComponent(ticket.accessToken)}`;
  const subject = `[${ticket.code}] Phản hồi từ ${senderName}`;

  const bodyHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
  <div style="background:#C4480A;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">${senderName} — Phản hồi hỗ trợ kỹ thuật</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
    <p style="color:#475569;margin-top:0">Xin chào <strong>${ticket.guestName}</strong>,</p>
    <p style="color:#475569">Nhóm kỹ thuật đã gửi phản hồi cho phiếu <strong>${ticket.code}</strong>:</p>
    <div style="background:#f8fafc;border-left:3px solid #C4480A;padding:16px;margin:16px 0;border-radius:0 8px 8px 0">
      <p style="white-space:pre-wrap;margin:0;color:#334155">${message.body}</p>
    </div>
    <a href="${accessLink}" style="display:inline-block;background:#C4480A;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">
      Xem &amp; Trả lời →
    </a>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:12px;color:#94a3b8;margin:0">
      Mã phiếu: ${ticket.code} · ${ticket.category}
    </p>
  </div>
</div>`;

  const bodyText = `Xin chào ${ticket.guestName},\n\nNhóm kỹ thuật đã phản hồi phiếu ${ticket.code}:\n\n${message.body}\n\nXem và trả lời: ${accessLink}`;

  return { subject, bodyHtml, bodyText };
}

// ─── Queue a pending notification record ─────────────────────────────────────

async function queueNotification(ticketId, messageId) {
  const key = buildIdempotencyKey(ticketId, messageId);
  return prisma.supportNotification.upsert({
    where: { idempotencyKey: key },
    create: { ticketId, messageId, idempotencyKey: key, status: 'pending' },
    update: {},
  });
}

// ─── Send one notification by ID ─────────────────────────────────────────────

export async function sendNotification(notifId) {
  const notif = await prisma.supportNotification.findUnique({ where: { id: notifId } });
  if (!notif) throw new Error('Notification not found');
  if (notif.status === 'sent') return { skipped: true };

  const ticket = await prisma.supportTicket.findUnique({ where: { id: notif.ticketId } });
  if (!ticket?.guestEmail) {
    await prisma.supportNotification.update({ where: { id: notifId }, data: { status: 'skipped' } });
    return { skipped: true, reason: 'no_email' };
  }

  const message = notif.messageId
    ? await prisma.supportMessage.findUnique({ where: { id: notif.messageId } })
    : null;
  if (!message) {
    await prisma.supportNotification.update({ where: { id: notifId }, data: { status: 'skipped' } });
    return { skipped: true, reason: 'no_message' };
  }

  const senderName = (await getSetting('contact.sender_name')) || 'DUCMANH PC';
  const fromAddress = process.env.SMTP_FROM || senderName;
  const { subject, bodyHtml, bodyText } = buildEmailContent(ticket, message, senderName);

  await prisma.supportNotification.update({ where: { id: notifId }, data: { attempts: { increment: 1 } } });

  try {
    let transport;
    try {
      transport = getResetMailTransport();
    } catch {
      await prisma.supportNotification.update({
        where: { id: notifId },
        data: { status: 'failed', lastError: 'SMTP chưa được cấu hình' },
      });
      return { sent: false, reason: 'smtp_not_configured' };
    }

    const info = await transport.sendMail({
      from: fromAddress,
      to: ticket.guestEmail,
      subject,
      text: bodyText,
      html: bodyHtml,
    });

    if (!info.accepted?.length) throw new Error('SMTP không chấp nhận người nhận.');

    await prisma.supportNotification.update({
      where: { id: notifId },
      data: { status: 'sent', sentAt: new Date(), lastError: null },
    });
    console.info(`[SupportNotif] sent → ${ticket.guestEmail} (ticket ${ticket.code})`);
    return { sent: true };
  } catch (e) {
    let safeError = String(e?.message || 'Unknown SMTP error');
    for (const secret of [process.env.SMTP_PASS, process.env.SMTP_PASS?.replace(/\s/g, '')]) {
      if (secret) safeError = safeError.split(secret).join('[redacted]');
    }
    await prisma.supportNotification.update({
      where: { id: notifId },
      data: { status: 'failed', lastError: safeError.slice(0, 500) },
    });
    return { sent: false, error: safeError };
  }
}

// ─── Fire-and-forget after admin reply ───────────────────────────────────────

export async function tryNotifyAfterReply(ticketId, messageId) {
  try {
    const notif = await queueNotification(ticketId, messageId);
    sendNotification(notif.id).catch(e =>
      console.warn('[SupportNotif] fire-and-forget failed (non-fatal):', e.message)
    );
  } catch (e) {
    console.warn('[SupportNotif] queue failed (non-fatal):', e.message);
  }
}

// ─── Manual retry ─────────────────────────────────────────────────────────────

export async function retryNotification(ticketId, messageId) {
  const key = buildIdempotencyKey(ticketId, messageId);
  const notif = await prisma.supportNotification.upsert({
    where: { idempotencyKey: key },
    create: { ticketId, messageId, idempotencyKey: key, status: 'pending' },
    update: { status: 'pending', lastError: null },
  });
  return sendNotification(notif.id);
}
