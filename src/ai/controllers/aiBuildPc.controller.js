import { generateBuildConfig } from '../services/aiBuildPc.service.js';

export async function postBuildPc(req, res) {
  try {
    const result = await generateBuildConfig(req.body);
    try {
      res.json({ success: result.success !== false, data: result });
    } catch (serializeErr) {
      console.error('[AI BuildPC] Response serialization error:', serializeErr?.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Lỗi khi gửi kết quả cấu hình. Vui lòng thử lại.' });
      }
    }
  } catch (e) {
    console.error('[AI BuildPC] Error:', e?.message || e, e?.stack ? `\n${e.stack}` : '');
    const status = e?.statusCode ?? 500;
    const message = e?.statusCode ? e.message : 'Đã xảy ra lỗi khi tạo cấu hình. Vui lòng thử lại sau.';
    const extra = {};
    if (e.code) extra.code = e.code;
    if (e.rateLimitType) extra.rateLimitType = e.rateLimitType;
    if (e.retryAfterMs > 0) extra.retryAfterMs = e.retryAfterMs;
    if (!res.headersSent) {
      res.status(status).json({ success: false, message, ...extra });
    }
  }
}
