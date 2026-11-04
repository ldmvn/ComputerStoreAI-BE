import { getUserPermissions } from '../services/rbac.service.js';

// requirePermission('products', 'create') — DB lookup per request.
// Requires authenticateToken to run first (sets req.user).
export function requirePermission(module, action) {
  return async (req, res, next) => {
    try {
      const perms = await getUserPermissions(req.user.userId);
      if (perms.has('*') || perms.has(`${module}:${action}`)) return next();
      return res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện hành động này.' });
    } catch (error) {
      next(error);
    }
  };
}

// requireAnyPermission(['orders:view', 'orders:manage'])
export function requireAnyPermission(keys) {
  return async (req, res, next) => {
    try {
      const perms = await getUserPermissions(req.user.userId);
      if (perms.has('*') || keys.some(k => perms.has(k))) return next();
      return res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện hành động này.' });
    } catch (error) {
      next(error);
    }
  };
}
