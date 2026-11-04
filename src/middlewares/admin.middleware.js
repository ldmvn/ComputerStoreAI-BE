import { findSafeUserById } from '../repositories/user.repository.js';

export async function requireAdmin(req, res, next) {
  try {
    const user = await findSafeUserById(req.user.userId);
    if (!user?.isActive || user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ quản trị viên đang hoạt động mới có thể thực hiện thao tác này.' });
    next();
  } catch (error) { next(error); }
}
