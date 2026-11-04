import * as rbac from '../services/rbac.service.js';
import { logActivity } from '../services/activityLog.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const err = (res, e) => res.status(e.status || 500).json({ success: false, message: e.message || 'Lỗi máy chủ.' });

export async function myPermissions(req, res) {
  try {
    const perms = await rbac.getUserPermissions(req.user.userId);
    const list = perms.has('*') ? ['*'] : [...perms];
    res.json({ permissions: list });
  } catch (e) { err(res, e); }
}

export async function listRoles(req, res) {
  try { ok(res, { roles: await rbac.listRoles() }); } catch (e) { err(res, e); }
}

export async function listPermissions(req, res) {
  try { ok(res, { permissions: await rbac.listPermissions() }); } catch (e) { err(res, e); }
}

export async function createRole(req, res) {
  try {
    const { name, slug, description, sortOrder } = req.body;
    if (!name?.trim() || !slug?.trim()) return res.status(422).json({ success: false, message: 'Tên và slug là bắt buộc.' });
    const role = await rbac.createRole({ name: name.trim(), slug: slug.trim(), description: description?.trim(), sortOrder: Number(sortOrder ?? 0) });
    await logActivity({ req, action: 'create', module: 'roles', targetId: role.id, targetLabel: role.name, description: `Tạo vai trò "${role.name}"` });
    ok(res, { role }, 201);
  } catch (e) { err(res, e); }
}

export async function updateRole(req, res) {
  try {
    const id = Number(req.params.id);
    const { name, slug, description, sortOrder, isActive } = req.body;
    const role = await rbac.updateRole(id, { name: name?.trim(), slug: slug?.trim(), description: description?.trim(), sortOrder: sortOrder != null ? Number(sortOrder) : undefined, isActive });
    await logActivity({ req, action: 'update', module: 'roles', targetId: role.id, targetLabel: role.name, description: `Cập nhật vai trò "${role.name}"` });
    ok(res, { role });
  } catch (e) { err(res, e); }
}

export async function deleteRole(req, res) {
  try {
    const id = Number(req.params.id);
    await rbac.deleteRole(id);
    await logActivity({ req, action: 'delete', module: 'roles', targetId: id, description: `Xóa vai trò ID ${id}` });
    ok(res, { message: 'Đã xóa vai trò.' });
  } catch (e) { err(res, e); }
}

export async function setRolePermissions(req, res) {
  try {
    const roleId = Number(req.params.id);
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) return res.status(422).json({ success: false, message: 'permissionIds phải là mảng.' });
    const role = await rbac.setRolePermissions(roleId, permissionIds.map(Number));
    await logActivity({ req, action: 'update', module: 'roles', targetId: roleId, targetLabel: role.name, description: `Cập nhật ${permissionIds.length} quyền cho vai trò "${role.name}"` });
    ok(res, { role });
  } catch (e) { err(res, e); }
}
