import * as service from '../services/attribute.service.js';
import {
  parseAttribute, parseCategoryIds, parseCategoryLinks,
  parseGroup, parseGroupMembers,
  parseOrder, parseStatus, parseValue, positiveId,
} from '../validators/attribute.validator.js';

const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

// ── Attribute ─────────────────────────────────────────────────────────────────
export const list           = wrap(async (_req, res) => res.json({ attributes: await service.listAttributes() }));
export const byCategory     = wrap(async (req, res) => res.json({ attributes: await service.categoryAttributes(positiveId(req.params.categoryId, 'Danh mục')) }));
export const publicByCategory = wrap(async (req, res) => res.json({ attributes: await service.categoryAttributesBySlug(String(req.params.slug || '').trim()) }));
export const create         = wrap(async (req, res) => res.status(201).json({ attribute: await service.createAttribute(parseAttribute(req.body)), message: 'Đã tạo thuộc tính.' }));
export const update         = wrap(async (req, res) => res.json({ attribute: await service.updateAttribute(positiveId(req.params.id), parseAttribute(req.body)), message: 'Đã cập nhật thuộc tính.' }));
export const remove         = wrap(async (req, res) => { await service.deleteAttribute(positiveId(req.params.id)); res.json({ message: 'Đã xóa thuộc tính.' }); });
export const status         = wrap(async (req, res) => res.json({ attribute: await service.setAttributeStatus(positiveId(req.params.id), parseStatus(req.body?.isActive)), message: 'Đã cập nhật trạng thái.' }));
export const order          = wrap(async (req, res) => res.json({ attribute: await service.setAttributeOrder(positiveId(req.params.id), parseOrder(req.body?.sortOrder)), message: 'Đã cập nhật thứ tự.' }));

// Simple backward-compat categories (plain id list)
export const categories     = wrap(async (req, res) => res.json({ attribute: await service.saveCategories(positiveId(req.params.id), parseCategoryIds(req.body)), message: 'Đã cập nhật danh mục.' }));

// Rich category-link upsert (full per-category flags)
export const categoryLinks  = wrap(async (req, res) => res.json({ attribute: await service.saveCategoryLinks(positiveId(req.params.id), parseCategoryLinks(req.body)), message: 'Đã cập nhật liên kết danh mục.' }));

// ── AttributeValue ────────────────────────────────────────────────────────────
export const createValue    = wrap(async (req, res) => res.status(201).json({ value: await service.createValue(positiveId(req.params.id), parseValue(req.body)), message: 'Đã thêm giá trị.' }));
export const updateValue    = wrap(async (req, res) => res.json({ value: await service.updateValue(positiveId(req.params.valueId), parseValue(req.body)), message: 'Đã cập nhật giá trị.' }));
export const valueStatus    = wrap(async (req, res) => res.json({ value: await service.updateValue(positiveId(req.params.valueId), { isActive: parseStatus(req.body?.isActive) }), message: 'Đã cập nhật trạng thái.' }));
export const valueOrder     = wrap(async (req, res) => res.json({ value: await service.updateValue(positiveId(req.params.valueId), { sortOrder: parseOrder(req.body?.sortOrder) }), message: 'Đã cập nhật thứ tự.' }));
export const removeValue    = wrap(async (req, res) => { await service.deleteValue(positiveId(req.params.valueId)); res.json({ message: 'Đã xóa giá trị.' }); });

// ── AttributeGroup ────────────────────────────────────────────────────────────
export const listGroups     = wrap(async (_req, res) => res.json({ groups: await service.listGroups() }));
export const createGroup    = wrap(async (req, res) => res.status(201).json({ group: await service.createGroup(parseGroup(req.body)), message: 'Đã tạo nhóm thuộc tính.' }));
export const updateGroup    = wrap(async (req, res) => res.json({ group: await service.updateGroup(positiveId(req.params.id), parseGroup(req.body)), message: 'Đã cập nhật nhóm.' }));
export const removeGroup    = wrap(async (req, res) => { await service.deleteGroup(positiveId(req.params.id)); res.json({ message: 'Đã xóa nhóm thuộc tính.' }); });
export const groupStatus    = wrap(async (req, res) => res.json({ group: await service.setGroupStatus(positiveId(req.params.id), parseStatus(req.body?.isActive)), message: 'Đã cập nhật trạng thái nhóm.' }));
export const groupOrder     = wrap(async (req, res) => res.json({ group: await service.setGroupOrder(positiveId(req.params.id), parseOrder(req.body?.sortOrder)), message: 'Đã cập nhật thứ tự nhóm.' }));
export const groupMembers   = wrap(async (req, res) => res.json({ group: await service.saveGroupMembers(positiveId(req.params.id), parseGroupMembers(req.body)), message: 'Đã cập nhật danh sách thuộc tính trong nhóm.' }));
