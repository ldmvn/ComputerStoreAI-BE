import test from 'node:test';
import assert from 'node:assert/strict';
import { isFullBuild } from '../../src/ai/services/aiBuildPc.service.js';

const items = (...slots) => ({ items: slots.map((slot, i) => ({ slot, productId: i + 1 })) });
const SIX = ['cpu', 'mainboard', 'ram', 'ssd', 'psu', 'case'];

test('6 linh kiện không có tản nhiệt CPU chưa phải bộ đủ', () => {
  assert.equal(isFullBuild(items(...SIX)), false);
  assert.equal(isFullBuild(items(...SIX, 'vga', 'case-fan')), false); // quạt case không thay được tản CPU
});

test('đủ 6 linh kiện cộng một tản nhiệt CPU (khí, AIO hoặc custom) là bộ đủ 7', () => {
  for (const cooler of ['cooler-air', 'cooler-aio', 'cooler-custom']) {
    assert.equal(isFullBuild(items(...SIX, cooler)), true, cooler);
  }
});

test('thiếu một linh kiện cốt lõi vẫn không đủ dù có tản nhiệt', () => {
  assert.equal(isFullBuild(items('cpu', 'mainboard', 'ram', 'psu', 'case', 'cooler-air')), false); // thiếu SSD
  assert.equal(isFullBuild({ items: [] }), false);
  assert.equal(isFullBuild(null), false);
});

test('linh kiện không có productId không được tính', () => {
  const tier = { items: [...SIX.map((slot, i) => ({ slot, productId: i + 1 })), { slot: 'cooler-air' }] };
  assert.equal(isFullBuild(tier), false);
});
