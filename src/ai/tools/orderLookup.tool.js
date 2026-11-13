// AI tool: look up the *authenticated* caller's own orders. Thin, real
// adapter over the existing Order Service — every call is threaded through
// `userId` taken from the verified JWT (never a value the user or the model
// supplies), so this can never be used to read someone else's order. That
// scoping is enforced by order.service.js itself (`where: { userId }`), not
// re-implemented here.

import { listOrders, getOrder } from '../../services/order.service.js';

export const orderLookupToolDefinition = {
  name: 'lookup_my_orders',
  description: 'Tra cứu đơn hàng của chính khách hàng đang đăng nhập. Chỉ dùng được sau khi xác thực — không thể tra cứu đơn hàng của người khác.',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'number', description: 'ID đơn hàng cụ thể cần tra cứu. Bỏ trống để liệt kê tất cả đơn hàng gần đây.' },
    },
  },
};

// Cùng tên trạng thái khách thấy ở trang "Đơn hàng của tôi" (CONFIRMED hiển thị là "Chờ lấy hàng").
export const ORDER_STATUS_LABEL = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Chờ lấy hàng',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

// Đơn trong DB chỉ lưu subtotal và discountAmount; tổng tiền khách phải trả = subtotal - discountAmount.
export function presentOrder(order) {
  const subtotal = Number(order.subtotal) || 0;
  const discountAmount = Number(order.discountAmount) || 0;
  return { ...order, statusLabel: ORDER_STATUS_LABEL[order.status] ?? order.status, totalAmount: subtotal - discountAmount };
}

/**
 * @param {{ orderId?: number }} args
 * @param {number} userId - from req.user.userId; never accepted from the request body or the model.
 */
export async function lookupMyOrders(args = {}, userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error('Vui lòng đăng nhập để tra cứu đơn hàng.');
    error.statusCode = 401;
    throw error;
  }
  if (args.orderId) {
    const order = await getOrder(userId, Number(args.orderId));
    return order ? { order: presentOrder(order) } : { order: null, message: 'Không tìm thấy đơn hàng này của bạn.' };
  }
  const orders = await listOrders(userId);
  // Đếm trên TOÀN BỘ đơn (không chỉ 10 đơn gần nhất) để trả lời đúng "tôi có bao nhiêu đơn chờ lấy hàng".
  const countsByStatus = {};
  for (const o of orders) {
    const label = ORDER_STATUS_LABEL[o.status] ?? o.status;
    countsByStatus[label] = (countsByStatus[label] ?? 0) + 1;
  }
  return { totalOrders: orders.length, countsByStatus, orders: orders.slice(0, 10).map(presentOrder) };
}
