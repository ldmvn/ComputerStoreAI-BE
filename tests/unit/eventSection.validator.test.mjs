import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEventSection } from '../../src/validators/productSection.validator.js';

const valid = {
  name: ' FLASH SALE GIÁ SỐC ', slug: 'Flash-Sale-Nha-Giao', badge: 'NHÂN NGÀY NHÀ GIÁO VIỆT NAM', promoTitle: '20/11',
  subtitle: 'Ưu đãi tri ân thầy cô', eventTheme: 'nha-giao', eventIcon: 'cap',
  startsAt: '2026-11-17T00:00:00.000Z', endsAt: '2026-11-20T16:59:59.000Z',
};

test('dữ liệu hợp lệ được làm sạch và gán loại EVENT_SECTION', () => {
  const data = validateEventSection(valid);
  assert.equal(data.type, 'EVENT_SECTION');
  assert.equal(data.name, 'FLASH SALE GIÁ SỐC');
  assert.equal(data.slug, 'flash-sale-nha-giao');
  assert.equal(data.badge, 'NHÂN NGÀY NHÀ GIÁO VIỆT NAM');
  assert.equal(data.eventTheme, 'nha-giao');
  assert.equal(data.startsAt.toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(data.viewAllUrl, '/customer/products?section=flash-sale-nha-giao');
});

test('chủ đề và biểu tượng lạ được đưa về mặc định', () => {
  const data = validateEventSection({ ...valid, eventTheme: 'khong-co', eventIcon: '<script>' });
  assert.equal(data.eventTheme, 'nha-giao');
  assert.equal(data.eventIcon, 'cap');
});

test('thiếu tên, tên sự kiện hoặc thời gian bị từ chối', () => {
  assert.throws(() => validateEventSection({ ...valid, name: '  ' }), /Tên ở giữa/);
  assert.throws(() => validateEventSection({ ...valid, startsAt: '' }), /bắt đầu/);
  assert.throws(() => validateEventSection({ ...valid, endsAt: 'không phải ngày' }), /kết thúc/);
});

test('tên sự kiện không bắt buộc', () => {
  assert.equal(validateEventSection({ ...valid, badge: '  ' }).badge, null);
  assert.throws(() => validateEventSection({ ...valid, badge: 'x'.repeat(101) }), /tối đa 100/);
});

test('kết thúc phải sau bắt đầu', () => {
  assert.throws(() => validateEventSection({ ...valid, endsAt: valid.startsAt }), /sau thời gian bắt đầu/);
  assert.throws(() => validateEventSection({ ...valid, endsAt: '2026-11-16T00:00:00.000Z' }), /sau thời gian bắt đầu/);
});

test('phần nhấn quá dài hoặc link không an toàn bị từ chối', () => {
  assert.throws(() => validateEventSection({ ...valid, promoTitle: 'x'.repeat(41) }), /Phần nhấn/);
  assert.throws(() => validateEventSection({ ...valid, viewAllUrl: 'javascript:alert(1)' }), /Link/);
});
