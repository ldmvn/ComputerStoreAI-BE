import test from 'node:test';
import assert from 'node:assert/strict';
import { presentOrder, ORDER_STATUS_LABEL } from '../../src/ai/tools/orderLookup.tool.js';

test('tổng tiền = subtotal - discountAmount, không còn NaN', () => {
  assert.equal(presentOrder({ id: 1, status: 'PENDING', subtotal: 3090000, discountAmount: 90000 }).totalAmount, 3000000);
  assert.equal(presentOrder({ id: 2, status: 'PENDING', subtotal: 10000 }).totalAmount, 10000);
});

test('trạng thái dùng đúng tên khách thấy trên trang đơn hàng', () => {
  assert.equal(presentOrder({ status: 'CONFIRMED' }).statusLabel, 'Chờ lấy hàng');
  assert.equal(presentOrder({ status: 'DELIVERED' }).statusLabel, 'Hoàn thành');
  assert.equal(Object.keys(ORDER_STATUS_LABEL).length, 5);
});
