import * as service from '../services/adminOrder.service.js';
import { notifyStatusChanged, notifyOrderCancelled } from '../services/telegramNotification.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const list = asyncHandler(async (req, res) => {
  const { page, limit, status, search, paymentMethod, paymentStatus, from, to } = req.query;
  const result = await service.listAllOrders({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    status, search, paymentMethod, paymentStatus, from, to,
  });
  res.json(result);
});

export const detail = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const order = await service.getAdminOrder(id);
  if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại.' });
  res.json({ order });
});

export const updateStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { status, note, trackingNumber, shippingProvider } = req.body;
  if (!status) return res.status(400).json({ message: 'Vui lòng cung cấp trạng thái mới.' });

  const before = await service.getAdminOrder(id);
  const order = await service.updateOrderStatus(id, { status, note, trackingNumber, shippingProvider }, req.user.userId);

  if (before && order) {
    if (status === 'CANCELLED') {
      notifyOrderCancelled(order, 'Quản trị viên').catch(e => console.error('[Telegram]', e.message));
    } else {
      notifyStatusChanged(order, before.status).catch(e => console.error('[Telegram]', e.message));
    }
  }

  res.json({ order, message: 'Cập nhật trạng thái đơn hàng thành công.' });
});

export const updateShipping = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { trackingNumber, shippingProvider, note } = req.body;
  const order = await service.updateShipping(id, { trackingNumber, shippingProvider, note }, req.user.userId);
  res.json({ order, message: 'Cập nhật thông tin vận chuyển thành công.' });
});

export const stats = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const data = await service.getOrderStats({ from, to });
  res.json(data);
});
