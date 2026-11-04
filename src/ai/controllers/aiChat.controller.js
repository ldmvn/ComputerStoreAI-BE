import { getAiStatus } from '../config/ai.config.js';
import { sendChatMessage } from '../services/aiChat.service.js';
import { parseChatRequest } from '../validators/aiChat.validator.js';

const err = (res, e) => {
  // Every error thrown inside the AI module sets its own statusCode with a
  // deliberately user-facing message (501 "not available", 400 validation,
  // 401 "log in to see orders", …) — those are safe to show as-is. Only a
  // truly unexpected exception (no statusCode at all) falls back to a
  // generic message, so it can never leak a stack trace or internal detail.
  const status = e?.statusCode ?? 500;
  const message = e?.statusCode ? e.message : 'Đã xảy ra lỗi. Vui lòng thử lại sau.';
  const extra = { ...(e.code ? { code: e.code } : {}) };
  if (e.rateLimitType) extra.rateLimitType = e.rateLimitType;
  if (e.retryAfterMs > 0) extra.retryAfterMs = e.retryAfterMs;
  res.status(status).json({ success: false, message, ...extra });
};

// GET /api/ai/status — public, booleans only (see ai.config.js#getAiStatus for what is deliberately withheld).
export async function getStatus(_req, res) {
  res.json({ success: true, data: getAiStatus() });
}

// POST /api/ai/chat — optionalAuth: anonymous callers get general/product_advice/faq
// contexts; order_lookup requires req.user (enforced inside the orderLookup tool,
// not here, so the 401 message is specific to "you need to log in to see orders").
export async function postChat(req, res) {
  try {
    const input = parseChatRequest(req.body);
    const result = await sendChatMessage(input, { userId: req.user?.userId ?? null });
    res.json({ success: true, data: result });
  } catch (e) {
    err(res, e);
  }
}
