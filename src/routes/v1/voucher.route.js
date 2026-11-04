import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { validateVoucher } from '../../services/voucher.service.js';

const router = Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// POST /api/vouchers/validate — authenticated users only
router.post('/validate', authenticateToken, asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code?.trim()) return res.status(400).json({ message: 'Vui lòng nhập mã giảm giá.' });
  const sub = parseInt(subtotal);
  if (!Number.isInteger(sub) || sub < 0) return res.status(400).json({ message: 'Giá trị đơn hàng không hợp lệ.' });
  const result = await validateVoucher(code.trim(), sub, req.user.userId);
  res.json(result);
}));

export default router;
