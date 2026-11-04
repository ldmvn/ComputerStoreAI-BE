import { listLogs, getLogDetail } from '../services/activityLog.service.js';

const ok = (res, data) => res.json({ success: true, ...data });
const err = (res, e) => res.status(e.status || 500).json({ success: false, message: e.message || 'Lỗi máy chủ.' });

export async function getLogs(req, res) {
  try {
    const { page = 1, limit = 30, module, action, userId, success, from, to, search } = req.query;
    ok(res, await listLogs({ page: Number(page), limit: Math.min(Number(limit), 100), module, action, userId, success, from, to, search }));
  } catch (e) { err(res, e); }
}

export async function getLog(req, res) {
  try {
    const log = await getLogDetail(Number(req.params.id));
    ok(res, { log });
  } catch (e) { err(res, e); }
}
