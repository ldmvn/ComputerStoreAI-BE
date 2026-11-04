import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetOrder, validateWidgetKey, WIDGET_CHANNEL_IDS } from '../../src/validators/supportWidget.validator.js';

test('widget.order accepts any permutation of the 4 known channel ids', () => {
  assert.equal(validateWidgetOrder('ai,zalo,messenger,telegram'), null); // default order
  assert.equal(validateWidgetOrder('zalo,ai,messenger,telegram'), null); // Chatbot AI moved
  assert.equal(validateWidgetOrder('ai,messenger,zalo,telegram'), null); // Zalo moved
  assert.equal(validateWidgetOrder('telegram,messenger,zalo,ai'), null); // fully reversed
  assert.equal(validateWidgetOrder(' ai , zalo , messenger , telegram '), null); // tolerates whitespace
});

test('widget.order rejects malformed sets', () => {
  assert.match(validateWidgetOrder('ai,zalo,messenger'), /đúng 4 kênh/); // missing id
  assert.match(validateWidgetOrder('ai,ai,zalo,messenger'), /đúng 4 kênh/); // duplicate id (telegram missing)
  assert.match(validateWidgetOrder('ai,zalo,messenger,telegram,extra'), /đúng 4 kênh/); // unknown id
  assert.match(validateWidgetOrder(''), /đúng 4 kênh/); // empty string — the exact payload the Save
                                                          // handler used to send before the fix
  assert.match(validateWidgetOrder(undefined), /phải là chuỗi/); // wrong type: undefined
  assert.match(validateWidgetOrder(null), /phải là chuỗi/); // wrong type: null
  assert.match(validateWidgetOrder(['ai', 'zalo', 'messenger', 'telegram']), /phải là chuỗi/); // wrong type: raw array, not joined
  assert.match(validateWidgetOrder('["ai","zalo","messenger","telegram"]'), /đúng 4 kênh/); // JSON string is not the accepted contract
});

test('validateWidgetKey routes widget.order through validateWidgetOrder', () => {
  assert.equal(validateWidgetKey('widget.order', WIDGET_CHANNEL_IDS.join(',')), null);
  assert.match(validateWidgetKey('widget.order', ''), /đúng 4 kênh/);
});

test('widget popup/channel text fields enforce length and reject markup', () => {
  assert.equal(validateWidgetKey('widget.popup.title', 'Liên hệ hỗ trợ'), null);
  assert.match(validateWidgetKey('widget.popup.title', 'x'.repeat(61)), /tối đa 60/);
  assert.equal(validateWidgetKey('widget.popup.description', 'Chúng tôi luôn sẵn sàng 24/7'), null);
  assert.match(validateWidgetKey('widget.popup.description', 'x'.repeat(121)), /tối đa 120/);
  assert.equal(validateWidgetKey('widget.ai.name', 'Chatbot AI'), null);
  assert.match(validateWidgetKey('widget.ai.name', 'x'.repeat(41)), /tối đa 40/);
  assert.match(validateWidgetKey('widget.zalo.description', '<script>alert(1)</script>'), /không được chứa ký tự/);
  assert.match(validateWidgetKey('widget.bogus.name', 'x'), /kênh không được hỗ trợ/);
});

test('widget.<id>.enabled only accepts the string booleans the toggle sends', () => {
  assert.equal(validateWidgetKey('widget.ai.enabled', 'true'), null);
  assert.equal(validateWidgetKey('widget.ai.enabled', 'false'), null);
  assert.match(validateWidgetKey('widget.ai.enabled', 'yes'), /phải là 'true' hoặc 'false'/);
});

test('widget.*Url fields can only be written by the dedicated media endpoints', () => {
  assert.match(validateWidgetKey('widget.ai.avatarUrl', '/media/support-widget/x.webp'), /không thể ghi trực tiếp/);
  assert.match(validateWidgetKey('widget.zalo.logoUrl', '/media/support-widget/x.webp'), /không thể ghi trực tiếp/);
});
