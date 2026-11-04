import * as svc from '../services/storeSetting.service.js';
import { ensureResetMailReady, sendTestMail } from '../services/passwordResetMail.service.js';
import { logActivity } from '../services/activityLog.service.js';
import {
  uploadWidgetMediaMiddleware,
  saveWidgetMedia,
  discardWidgetMediaTemp,
  removeWidgetMedia,
  keyFromWidgetMediaUrl,
  WIDGET_MEDIA_CHANNELS,
} from '../services/supportWidgetMedia.service.js';
import { validateWidgetKey } from '../validators/supportWidget.validator.js';

const err = (res, e) => {
  const status = e?.status ?? e?.statusCode ?? 500;
  res.status(status).json({ success: false, message: e.message });
};

// Allowed hostnames per social channel
const SOCIAL_HOSTNAMES = {
  zalo: ['zalo.me'],
  messenger: ['m.me', 'www.messenger.com', 'messenger.com'],
  telegram: ['t.me', 'telegram.me', 'telegram.org'],
};

function validateSocialUrl(key, value) {
  // key format: social.<channel>.url
  const [, channel] = key.split('.');
  const allowed = SOCIAL_HOSTNAMES[channel];
  if (!allowed) return `Kênh '${channel}' không được hỗ trợ.`;
  if (!value) return null; // empty = cleared, OK

  let parsed;
  try { parsed = new URL(value); } catch { return 'URL không hợp lệ.'; }

  if (parsed.protocol !== 'https:') return 'Chỉ chấp nhận URL bắt đầu bằng https://.';
  if (parsed.username || parsed.password) return 'URL không được chứa thông tin đăng nhập.';
  if (!allowed.includes(parsed.hostname)) return `URL phải thuộc domain: ${allowed.join(', ')}.`;
  return null;
}

// In-memory rate limit: max 3 test emails per userId per 60 s
const _testEmailBucket = new Map();
function _allowTestEmail(userId) {
  const now = Date.now();
  const entry = _testEmailBucket.get(userId) ?? { n: 0, t: now };
  if (now - entry.t > 60_000) { entry.n = 1; entry.t = now; }
  else entry.n++;
  _testEmailBucket.set(userId, entry);
  return entry.n <= 3;
}

export async function getAll(req, res) {
  try {
    const data = await svc.getAllSettings();
    res.json({ success: true, data });
  } catch (e) { err(res, e); }
}

export async function getPublicStore(req, res) {
  try {
    const data = await svc.getSettingsByPrefix('store.');
    const social = await svc.getSettingsByPrefix('social.');
    const footer = await svc.getSettingsByPrefix('footer.');
    const widget = await svc.getSettingsByPrefix('widget.');
    res.json({ success: true, data: { ...data, ...social, ...footer, ...widget } });
  } catch (e) { err(res, e); }
}

export async function getPublicFeatureFlags(req, res) {
  try {
    const raw = await svc.getSettingsByPrefix('feature.');
    res.json({
      success: true,
      data: {
        build_pc: (raw['feature.build_pc'] ?? 'true') === 'true',
        reviews:  (raw['feature.reviews'] ?? 'true') === 'true',
        wishlist: (raw['feature.wishlist'] ?? 'true') === 'true',
      },
    });
  } catch (e) { err(res, e); }
}

export async function getPublicSeo(req, res) {
  try {
    const raw = await svc.getSettingsByPrefix('seo.');
    res.json({ success: true, data: raw });
  } catch (e) { err(res, e); }
}

export async function getPublicPaymentStatus(req, res) {
  try {
    const raw = await svc.getSettingsByPrefix('payment.');
    const methods = ['cod', 'bank_transfer', 'vnpay', 'momo'];
    const result = {};
    for (const m of methods) {
      result[m] = raw[`payment.${m}.status`] ?? 'active';
    }
    res.json({ success: true, data: result });
  } catch (e) { err(res, e); }
}

export async function update(req, res) {
  try {
    const body = req.body ?? {};
    for (const [key, value] of Object.entries(body)) {
      if (/^social\.[^.]+\.url$/.test(key)) {
        const msg = validateSocialUrl(key, String(value ?? ''));
        if (msg) return res.status(400).json({ success: false, message: `${key}: ${msg}` });
        continue;
      }
      if (key.startsWith('widget.')) {
        const msg = validateWidgetKey(key, value);
        if (msg) return res.status(400).json({ success: false, message: msg });
      }
    }
    await svc.setSettings(body);
    res.json({ success: true, message: 'Đã lưu cài đặt.' });
  } catch (e) { err(res, e); }
}

// ── Widget media (channel logo / chatbot avatar) ──────────────────────────────

export { uploadWidgetMediaMiddleware as uploadWidgetMediaMw };

export async function uploadWidgetMedia(req, res) {
  const { channel } = req.params;
  let saved;
  try {
    if (!WIDGET_MEDIA_CHANNELS[channel]) {
      return res.status(400).json({ success: false, message: 'Kênh không được hỗ trợ.' });
    }
    saved = await saveWidgetMedia(req.file, channel);
    const settingKey = WIDGET_MEDIA_CHANNELS[channel];
    const old = await svc.getSetting(settingKey);
    await svc.setSettings({ [settingKey]: saved.url });
    if (old) await removeWidgetMedia(keyFromWidgetMediaUrl(old));
    await logActivity({ req, action: 'update_widget_media', module: 'settings', description: `Cập nhật ảnh widget hỗ trợ (${channel})`, success: true }).catch(() => {});
    res.json({ success: true, data: { url: saved.url }, message: 'Đã cập nhật ảnh.' });
  } catch (e) {
    if (saved) await removeWidgetMedia(saved.key);
    err(res, e);
  } finally {
    await discardWidgetMediaTemp(req.file);
  }
}

export async function deleteWidgetMedia(req, res) {
  try {
    const { channel } = req.params;
    if (!WIDGET_MEDIA_CHANNELS[channel]) {
      return res.status(400).json({ success: false, message: 'Kênh không được hỗ trợ.' });
    }
    const settingKey = WIDGET_MEDIA_CHANNELS[channel];
    const old = await svc.getSetting(settingKey);
    await svc.setSettings({ [settingKey]: '' });
    if (old) await removeWidgetMedia(keyFromWidgetMediaUrl(old));
    await logActivity({ req, action: 'delete_widget_media', module: 'settings', description: `Khôi phục ảnh mặc định widget hỗ trợ (${channel})`, success: true }).catch(() => {});
    res.json({ success: true, message: 'Đã khôi phục ảnh mặc định.' });
  } catch (e) { err(res, e); }
}

export async function getSmtpStatus(req, res) {
  try {
    const host = process.env.SMTP_HOST?.trim() || null;
    const from = process.env.SMTP_FROM?.trim() || null;
    const hasAuth = !!(process.env.SMTP_USER?.trim());
    const port = process.env.SMTP_PORT || '587';
    const configured = !!(host && from);
    // Try cached verify state — don't block on a live connect
    let lastError = null;
    if (configured) {
      try { await ensureResetMailReady(); } catch (e) { lastError = e.code || 'SMTP_ERROR'; }
    }
    res.json({ success: true, data: { configured, host, port, from, hasAuth, lastError } });
  } catch (e) { err(res, e); }
}

export async function sendTestEmail(req, res) {
  try {
    const { to } = req.body ?? {};
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
      return res.status(400).json({ success: false, message: 'Địa chỉ email không hợp lệ.' });
    }
    const userId = req.user?.userId;
    if (!_allowTestEmail(userId)) {
      return res.status(429).json({ success: false, message: 'Quá nhiều yêu cầu gửi email thử. Vui lòng chờ 1 phút.' });
    }
    await sendTestMail(to.trim());
    const maskedTo = to.replace(/(.{2}).*(@.*)/, '$1***$2');
    await logActivity({ req, action: 'test_email', module: 'settings', description: `Gửi email thử đến ${maskedTo}`, success: true }).catch(() => {});
    res.json({ success: true, message: 'Email thử đã được gửi. Vui lòng kiểm tra hộp thư.' });
  } catch (e) {
    const maskedTo = String(req.body?.to ?? '').replace(/(.{2}).*(@.*)/, '$1***$2');
    await logActivity({ req, action: 'test_email', module: 'settings', description: `Gửi email thử thất bại (${e.code || 'SMTP_ERROR'}) đến ${maskedTo}`, success: false }).catch(() => {});
    const status = e?.statusCode || 500;
    const safe = ['SMTP_CONFIG_MISSING', 'SMTP_CONFIG_INVALID', 'SMTP_RECIPIENT_REJECTED', 'EAUTH'].includes(e.code)
      ? e.message
      : 'Không gửi được email. Kiểm tra cấu hình SMTP trong file backend/.env.';
    res.status(status).json({ success: false, message: safe });
  }
}
