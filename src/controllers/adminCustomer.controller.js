import * as service from '../services/adminCustomer.service.js';
import { logActivity } from '../services/activityLog.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const stats = asyncHandler(async (_req, res) => {
  const data = await service.getCustomerStats();
  res.json(data);
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, filter, sortBy } = req.query;
  const result = await service.listCustomers({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    search,
    filter,
    sortBy,
  });
  res.json(result);
});

export const detail = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const customer = await service.getCustomer(id);
  if (!customer) return res.status(404).json({ message: 'Tài khoản không tồn tại.' });
  res.json({ customer });
});

export const create = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password } = req.body;
  if (!fullName?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: 'Họ tên, email và mật khẩu là bắt buộc.' });
  }
  const customer = await service.createCustomer({ fullName: fullName.trim(), email: email.trim(), phone: phone?.trim(), password });
  await logActivity({ req, action: 'create', module: 'customers', targetId: customer.id, targetLabel: customer.email, description: `Tạo tài khoản "${customer.email}"` });
  res.status(201).json({ customer });
});

export const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { fullName, email, phone, isActive, password } = req.body;
  const customer = await service.updateCustomer(id, { fullName, email, phone, isActive, password });
  await logActivity({ req, action: 'update', module: 'customers', targetId: id, targetLabel: customer.email, description: `Cập nhật tài khoản "${customer.email}"` });
  res.json({ customer });
});

export const updateRole = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { role, adminRoleId } = req.body;
  if (!['USER', 'ADMIN'].includes(role)) return res.status(422).json({ message: 'role phải là USER hoặc ADMIN.' });
  const customer = await service.updateAccountRole(id, { role, adminRoleId: adminRoleId ? Number(adminRoleId) : null }, req.user.userId);
  const roleLabel = customer.role === 'ADMIN' ? (customer.adminRole?.name || 'Admin (Toàn quyền)') : 'Khách hàng';
  await logActivity({ req, action: 'update_role', module: 'administrators', targetId: id, targetLabel: customer.email, description: `Đổi vai trò "${customer.email}" thành ${roleLabel}` });
  res.json({ customer });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  await service.deleteCustomer(id, req.user.userId);
  await logActivity({ req, action: 'delete', module: 'customers', targetId: id, description: `Xóa tài khoản #${id}` });
  res.json({ success: true });
});

export const activityLogs = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { page = 1, limit = 30 } = req.query;
  const result = await service.getCustomerActivity(id, { page: Number(page), limit: Math.min(Number(limit), 100) });
  res.json(result);
});
