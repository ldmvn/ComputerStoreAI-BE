import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderConfirmationEmail, sendOrderConfirmation, escapeHtml, orderTotal } from '../../src/services/orderConfirmationMail.service.js';

const baseOrder = (over = {}) => ({
  id: 1201, userId: 7, paymentMethod: 'COD', note: null,
  shippingName: 'Nguyễn Văn A', shippingPhone: '0901234567', shippingAddress: '12 Lê Lợi, Phường 1, TP. Hồ Chí Minh',
  subtotal: 25_980_000, discountAmount: 0, createdAt: '2026-11-10T03:00:00.000Z',
  items: [
    { name: 'CPU AMD Ryzen 5 9600X', price: 5_490_000, quantity: 1, primaryImage: '/media/products/a.webp' },
    { name: 'RAM Kingston 16GB', price: 1_290_000, quantity: 2, primaryImage: null },
  ],
  payment: { attempts: [] },
  ...over,
});
const build = (order) => buildOrderConfirmationEmail(order, { customerName: 'Nguyễn Văn A', senderName: 'DUCMANH PC', frontendUrl: 'https://ducmanh.store/' });

test('subject, order id, items and total are present', () => {
  const { subject, html, text } = build(baseOrder());
  assert.match(subject, /#1201/);
  for (const part of ['CPU AMD Ryzen 5 9600X', 'RAM Kingston 16GB', '25.980.000đ', 'https://ducmanh.store/customer/orders/1201']) {
    assert.ok(html.includes(part), `html missing ${part}`);
    assert.ok(text.includes(part), `text missing ${part}`);
  }
  assert.ok(html.includes('https://ducmanh.store/media/products/a.webp'), 'relative image becomes absolute without double slash');
});

test('total subtracts the voucher discount and shows both lines', () => {
  const o = baseOrder({ subtotal: 10_000_000, discountAmount: 1_500_000 });
  assert.equal(orderTotal(o), 8_500_000);
  const { html } = build(o);
  assert.ok(html.includes('8.500.000đ') && html.includes('-1.500.000đ'));
  assert.equal(orderTotal(baseOrder({ subtotal: 100, discountAmount: 500 })), 0);
});

test('user-controlled fields are HTML-escaped', () => {
  const evil = '<script>alert(1)</script>"&';
  const { html } = build(baseOrder({ shippingName: evil, shippingAddress: evil, note: evil, items: [{ name: evil, price: 1, quantity: 1 }] }));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(escapeHtml(`a'b`), 'a&#39;b');
});

test('payment section differs per method', () => {
  assert.match(build(baseOrder({ paymentMethod: 'COD' })).html, /khi nhận hàng/);
  const bank = build(baseOrder({ paymentMethod: 'BANK_TRANSFER', payment: { attempts: [{ bankName: 'MB Bank', bankAccountNumber: '123456789', bankAccountName: 'CUA HANG', transferContent: 'DUCMANHPC DH1201' }] } }));
  for (const s of ['MB Bank', '123456789', 'DUCMANHPC DH1201', 'chưa được thanh toán']) assert.ok(bank.html.includes(s), s);
  assert.ok(bank.text.includes('DUCMANHPC DH1201'));
  const momo = build(baseOrder({ paymentMethod: 'MOMO' }));
  assert.match(momo.html, /chưa được thanh toán/);
  assert.ok(momo.text.includes('/customer/orders/1201'));
  // bank transfer without attempt data must still render
  assert.match(build(baseOrder({ paymentMethod: 'BANK_TRANSFER' })).html, /chuyển khoản/);
});

test('sendOrderConfirmation sends once to the account email and dedupes', async () => {
  const sent = [];
  const transport = { sendMail: async m => { sent.push(m); return { accepted: [m.to] }; } };
  const customer = { email: 'khach@example.com', fullName: 'Khách' };
  const order = baseOrder({ id: 9001 });
  assert.deepEqual(await sendOrderConfirmation(order, { transport, customer }), { sent: true });
  assert.equal(sent[0].to, 'khach@example.com');
  assert.match(sent[0].subject, /#9001/);
  assert.deepEqual(await sendOrderConfirmation(order, { transport, customer }), { skipped: true, reason: 'duplicate' });
  assert.equal(sent.length, 1);
});

test('SMTP failure is reported, not thrown, and allows a later retry', async () => {
  const transport = { sendMail: async () => { throw Object.assign(new Error('bad creds'), { code: 'EAUTH' }); } };
  const customer = { email: 'khach@example.com', fullName: 'Khách' };
  const order = baseOrder({ id: 9002 });
  const res = await sendOrderConfirmation(order, { transport, customer });
  assert.deepEqual(res, { sent: false, error: 'EAUTH' });
  const ok = { sendMail: async m => ({ accepted: [m.to] }) };
  assert.deepEqual(await sendOrderConfirmation(order, { transport: ok, customer }), { sent: true });
});

test('rejected recipient and missing email are handled', async () => {
  const customer = { email: 'khach@example.com', fullName: 'K' };
  const rejecting = { sendMail: async () => ({ accepted: [] }) };
  assert.equal((await sendOrderConfirmation(baseOrder({ id: 9003 }), { transport: rejecting, customer })).sent, false);
  assert.deepEqual(await sendOrderConfirmation(baseOrder({ id: 9004 }), { transport: rejecting, customer: { email: '' } }), { skipped: true, reason: 'no_email' });
});
