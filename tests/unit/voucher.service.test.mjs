import test from 'node:test';
import assert from 'node:assert/strict';
import { calcDiscount } from '../../src/services/voucher.service.js';

// ---------------------------------------------------------------------------
// calcDiscount — pure function, no DB needed
// ---------------------------------------------------------------------------

test('calcDiscount PERCENT: tính đúng và áp dụng maxDiscount', () => {
  // 10% của 1.500.000 = 150.000 (không giới hạn)
  assert.equal(calcDiscount({ type: 'PERCENT', value: 10, maxDiscount: null }, 1_500_000), 150_000);

  // 10% của 1.500.000 = 150.000, nhưng giới hạn 100.000
  assert.equal(calcDiscount({ type: 'PERCENT', value: 10, maxDiscount: 100_000 }, 1_500_000), 100_000);

  // Floor: 10% của 999 = 99.9 → 99
  assert.equal(calcDiscount({ type: 'PERCENT', value: 10, maxDiscount: null }, 999), 99);

  // 0%: luôn bằng 0
  assert.equal(calcDiscount({ type: 'PERCENT', value: 0, maxDiscount: null }, 500_000), 0);

  // 100%: giảm toàn bộ (không giới hạn)
  assert.equal(calcDiscount({ type: 'PERCENT', value: 100, maxDiscount: null }, 200_000), 200_000);
});

test('calcDiscount FIXED: không vượt subtotal', () => {
  // Giảm bình thường
  assert.equal(calcDiscount({ type: 'FIXED', value: 50_000, maxDiscount: null }, 200_000), 50_000);

  // Giảm bằng đúng subtotal
  assert.equal(calcDiscount({ type: 'FIXED', value: 200_000, maxDiscount: null }, 200_000), 200_000);

  // Giảm vượt subtotal → cắt về subtotal
  assert.equal(calcDiscount({ type: 'FIXED', value: 500_000, maxDiscount: null }, 200_000), 200_000);

  // Giảm 0
  assert.equal(calcDiscount({ type: 'FIXED', value: 0, maxDiscount: null }, 200_000), 0);
});
