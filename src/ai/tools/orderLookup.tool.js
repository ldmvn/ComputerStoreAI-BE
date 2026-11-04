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
    return order ? { order } : { order: null, message: 'Không tìm thấy đơn hàng này của bạn.' };
  }
  const orders = await listOrders(userId);
  return { orders: orders.slice(0, 10) };
}
