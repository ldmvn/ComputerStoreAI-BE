#!/usr/bin/env node
// Run: node backend/scripts/test-telegram.js
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment or .env

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

import { notifyNewOrder, notifyOrderCancelled, notifyStatusChanged } from '../src/services/telegramNotification.service.js';

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.error('❌ Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env');
  process.exit(1);
}

console.log('📤 Gửi test notifications...\n');

const fakeOrder = {
  id: 9999,
  shippingName: 'Nguyễn Test',
  shippingPhone: '0386220065',
  shippingAddress: '5 Lê Duẩn, Phú Thọ',
  subtotal: 15_990_000,
  discountAmount: 500_000,
  paymentMethod: 'COD',
  status: 'PENDING',
  items: [{ id: 1 }, { id: 2 }],
  createdAt: new Date(),
  cancelledAt: new Date(),
};

await notifyNewOrder(fakeOrder);
console.log('✅ notifyNewOrder gửi xong');

await notifyStatusChanged({ ...fakeOrder, status: 'CONFIRMED' }, 'PENDING');
console.log('✅ notifyStatusChanged (PENDING → CONFIRMED) gửi xong');

await notifyStatusChanged({ ...fakeOrder, status: 'SHIPPING' }, 'CONFIRMED');
console.log('✅ notifyStatusChanged (CONFIRMED → SHIPPING) gửi xong');

// Reset dedup để test cancel (same orderId 9999)
await new Promise(r => setTimeout(r, 10_100));
await notifyOrderCancelled({ ...fakeOrder, status: 'CANCELLED' }, 'Khách hàng');
console.log('✅ notifyOrderCancelled gửi xong');

console.log('\nKiểm tra Telegram của bạn — 4 tin nhắn test đã được gửi.');
