import { prisma } from '../config/prisma.js';
import { logActivity } from '../services/activityLog.service.js';
import sanitizeHtml from 'sanitize-html';

// ── Allowlist of editable page keys ──────────────────────────────────────────
const ALLOWED_KEYS = new Set([
  'warranty', 'privacy', 'return', 'terms', 'payment', 'shipping', 'about', 'guide',
]);

const SANITIZE_OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4',
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
    'div', 'span',
  ],
  allowedAttributes: {
    'a':    ['href', 'target', 'rel', 'title'],
    'img':  ['src', 'alt', 'width', 'height'],
    'td':   ['colspan', 'rowspan', 'style', 'class'],
    'th':   ['colspan', 'rowspan', 'style', 'class'],
    'col':  ['style', 'width'],
    'div':  ['style', 'class'],
    'span': ['style', 'class'],
    'p':    ['style', 'class'],
    'h2':   ['id', 'style', 'class'],
    'h3':   ['id', 'style', 'class'],
    'h4':   ['id', 'style', 'class'],
    '*':    ['class'],
  },
  allowedStyles: {
    '*': {
      'text-align':      [/^(left|center|right|justify)$/],
      'font-weight':     [/^\d+$/, /^(bold|normal)$/],
      'font-style':      [/^(italic|normal)$/],
      'text-decoration': [/^(underline|line-through|none)$/],
      'width':           [/^\d+(%|px|em)$/],
      'min-width':       [/^\d+(%|px|em)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
};

// ── Public: GET /api/content/pages/:key ───────────────────────────────────────

export async function publicGetPage(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(404).json({ success: false, message: 'Trang không tồn tại.' });
  }
  const page = await prisma.policyPage.findUnique({ where: { pageKey: key } });
  if (!page) return res.status(404).json({ success: false, message: 'Chưa có nội dung.' });
  res.json({ success: true, data: page });
}

// ── Admin: GET /api/admin/content-pages/:key ──────────────────────────────────

export async function adminGetPage(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(404).json({ success: false, message: 'Trang không tồn tại.' });
  }
  const page = await prisma.policyPage.findUnique({ where: { pageKey: key } });
  if (!page) return res.status(404).json({ success: false, message: 'Chưa có nội dung.' });
  res.json({ success: true, data: page });
}

// ── Admin: PUT /api/admin/content-pages/:key ──────────────────────────────────

export async function adminUpdatePage(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(404).json({ success: false, message: 'Trang không tồn tại.' });
  }

  const { title, description, contentHtml } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ success: false, message: 'Tiêu đề không được để trống.' });
  }
  if (!contentHtml?.trim()) {
    return res.status(400).json({ success: false, message: 'Nội dung không được để trống.' });
  }

  const clean = sanitizeHtml(contentHtml, SANITIZE_OPTIONS);

  const page = await prisma.policyPage.upsert({
    where:  { pageKey: key },
    create: {
      pageKey:          key,
      title:            title.trim(),
      description:      description?.trim() || null,
      contentHtml:      clean,
      updatedByAdminId: req.user?.id ?? null,
    },
    update: {
      title:            title.trim(),
      description:      description?.trim() || null,
      contentHtml:      clean,
      updatedByAdminId: req.user?.id ?? null,
    },
  });

  await logActivity({
    adminId:     req.user.id,
    action:      'update',
    module:      'content_pages',
    targetId:    page.id,
    targetLabel: `ContentPage:${key}`,
    description: `Cập nhật nội dung trang: ${page.title}`,
  }).catch(() => {});

  res.json({ success: true, data: page });
}
