// AI tool: look up the *authenticated* caller's own orders. Thin, real
// adapter over the existing Order Service — every call is threaded through
// `userId` taken from the verified JWT (never a value the user or the model
// supplies), so this can never be used to read someone else's order. That
// scoping is enforced by order.service.js itself (`where: { userId }`), not
// re-implemented here.

import { listOrders, getOrder } from '../../services/order.service.js';

export const orderLookupToolDefinition = {
  name: 'lookup_my_orders',
  description: 'Tra cứu đơn hàng của chính khách hàng đang đăng nhập. Khi không truyền orderId, trả về danh sách tóm tắt TẤT CẢ đơn kèm thống kê tính sẵn trong stats: stats.donConHieuLuc (đơn chưa hủy) và stats.donDaHuy (đơn đã hủy), mỗi nhóm có donDatNhat, donReNhat, tongChiTieu. LUÔN dùng số liệu từ stats, KHÔNG tự so sánh.',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'number', description: 'ID đơn hàng cụ thể cần tra cứu chi tiết. Bỏ trống để liệt kê tóm tắt tất cả đơn hàng.' },
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
  // Tính tổng tiền cho mỗi đơn một lần.
  const withTotal = orders.map(o => {
    const subtotal = Number(o.subtotal) || 0;
    const discountAmount = Number(o.discountAmount) || 0;
    return { order: o, totalAmount: subtotal - discountAmount };
  });

  // Thống kê tính sẵn để LLM không phải tự so sánh (tránh hallucination).
  const active = withTotal.filter(x => x.order.status !== 'CANCELLED');
  const cancelled = withTotal.filter(x => x.order.status === 'CANCELLED');

  function computeStats(list) {
    if (!list.length) return null;
    let minItem = list[0], maxItem = list[0], sum = 0;
    for (const x of list) {
      sum += x.totalAmount;
      if (x.totalAmount < minItem.totalAmount) minItem = x;
      if (x.totalAmount > maxItem.totalAmount) maxItem = x;
    }
    const fmt = x => ({ maDon: x.order.id, tongTien: x.totalAmount, sanPham: x.order.items?.[0]?.name ?? '', trangThai: ORDER_STATUS_LABEL[x.order.status] ?? x.order.status });
    return { donReNhat: fmt(minItem), donDatNhat: fmt(maxItem), tongChiTieu: sum, soDon: list.length };
  }

  const stats = {
    donConHieuLuc: computeStats(active),
    donDaHuy: computeStats(cancelled),
  };

  // Trả tóm tắt từng đơn + thống kê tính sẵn.
  const summaries = withTotal.map(x => ({
    id: x.order.id,
    status: x.order.status,
    statusLabel: ORDER_STATUS_LABEL[x.order.status] ?? x.order.status,
    totalAmount: x.totalAmount,
    itemCount: x.order.items?.length ?? 0,
    firstItemName: x.order.items?.[0]?.name ?? '',
    createdAt: x.order.createdAt,
  }));
  return { totalOrders: orders.length, countsByStatus, stats, orders: summaries };
}
