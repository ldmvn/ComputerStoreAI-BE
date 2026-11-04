import * as service from '../services/adminBuildPc.service.js';
import { logActivity } from '../services/activityLog.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const err = (res, e) => res.status(e.status || 500).json({ success: false, message: e.message || 'Lỗi máy chủ.' });

export const summary = asyncHandler(async (_req, res) => {
  ok(res, { summary: await service.getSummary() });
});

// ── Rules ─────────────────────────────────────────────────────────────────────

export const listRules = asyncHandler(async (_req, res) => {
  ok(res, await service.listRules());
});

export const createRule = asyncHandler(async (req, res) => {
  const { name, ruleType, groupAId, attributeASlug, groupBId, attributeBSlug } = req.body;
  if (!name?.trim() || !ruleType || !groupAId || !attributeASlug || !groupBId || !attributeBSlug) {
    return res.status(422).json({ success: false, message: 'Thiếu thông tin bắt buộc.' });
  }
  try {
    const rule = await service.createRule(req.body);
    await logActivity({ req, action: 'create', module: 'build_pc', targetId: rule.id, targetLabel: rule.name, description: `Tạo quy tắc tương thích "${rule.name}"` });
    ok(res, { rule }, 201);
  } catch (e) { err(res, e); }
});

export const updateRule = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
  try {
    const rule = await service.updateRule(id, req.body);
    await logActivity({ req, action: 'update', module: 'build_pc', targetId: id, targetLabel: rule.name, description: `Cập nhật quy tắc tương thích "${rule.name}"` });
    ok(res, { rule });
  } catch (e) { err(res, e); }
});

export const deleteRule = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
  try {
    await service.deleteRule(id);
    await logActivity({ req, action: 'delete', module: 'build_pc', targetId: id, description: `Xóa quy tắc tương thích #${id}` });
    ok(res, { success: true });
  } catch (e) { err(res, e); }
});

// ── Presets ───────────────────────────────────────────────────────────────────

export const listPresets = asyncHandler(async (_req, res) => {
  ok(res, { presets: await service.listPresets() });
});

export const getPreset = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const preset = await service.getPreset(id);
  if (!preset) return res.status(404).json({ success: false, message: 'Preset không tồn tại.' });
  ok(res, { preset });
});

export const createPreset = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(422).json({ success: false, message: 'Tên preset là bắt buộc.' });
  try {
    const preset = await service.createPreset(req.body);
    await logActivity({ req, action: 'create', module: 'build_pc', targetId: preset.id, targetLabel: preset.name, description: `Tạo preset Build PC "${preset.name}"` });
    ok(res, { preset }, 201);
  } catch (e) { err(res, e); }
});

export const updatePreset = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
  try {
    const preset = await service.updatePreset(id, req.body);
    await logActivity({ req, action: 'update', module: 'build_pc', targetId: id, targetLabel: preset.name, description: `Cập nhật preset Build PC "${preset.name}"` });
    ok(res, { preset });
  } catch (e) { err(res, e); }
});

export const deletePreset = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
  try {
    await service.deletePreset(id);
    await logActivity({ req, action: 'delete', module: 'build_pc', targetId: id, description: `Xóa preset Build PC #${id}` });
    ok(res, { success: true });
  } catch (e) { err(res, e); }
});

// ── Attribute coverage ───────────────────────────────────────────────────────

export const attributeCoverage = asyncHandler(async (_req, res) => {
  ok(res, { coverage: await service.getAttributeCoverage() });
});

export const missingAttributeProducts = asyncHandler(async (req, res) => {
  const { category, attribute, page, limit } = req.query;
  if (!category || !attribute) return res.status(400).json({ success: false, message: 'Thiếu category hoặc attribute.' });
  ok(res, await service.getProductsMissingAttribute(category, attribute, {
    page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20,
  }));
});

// ── Build sessions ────────────────────────────────────────────────────────────

export const listBuildSessions = asyncHandler(async (req, res) => {
  const { page, limit, from, to, userId, minPrice, maxPrice } = req.query;
  ok(res, await service.listBuildSessions({
    page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20,
    from, to, userId, minPrice, maxPrice,
  }));
});

export const getBuildSession = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
  const session = await service.getBuildSessionDetail(id);
  if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình.' });
  ok(res, { session });
});

// ── Data issues ───────────────────────────────────────────────────────────────

export const dataIssues = asyncHandler(async (_req, res) => {
  ok(res, { issues: await service.getDataIssues() });
});
