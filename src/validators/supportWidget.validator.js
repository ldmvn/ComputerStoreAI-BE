// Floating Support Widget settings validation.
// Key namespace: widget.popup.{title,description}, widget.<channel>.{name,description,enabled},
// widget.order. Channel logo/avatar URLs are written only by the dedicated
// upload/delete handlers (never accepted as free-text here), so they stay
// scoped to files that service itself produced.

export const WIDGET_CHANNEL_IDS = ['ai', 'zalo', 'messenger', 'telegram'];

const NO_MARKUP_RE = /[<>]/;

export function validateWidgetText(key, value, maxLen) {
  if (value == null) return null;
  const v = String(value);
  if (v.length > maxLen) return `${key}: tối đa ${maxLen} ký tự.`;
  if (NO_MARKUP_RE.test(v)) return `${key}: không được chứa ký tự < hoặc >.`;
  return null;
}

// Accepts a comma-separated string of the 4 channel ids in any order (each
// exactly once). Order of the ids carries the display order; validation is
// order-independent — it only checks the *set* is exactly the 4 known ids.
export function validateWidgetOrder(value) {
  if (typeof value !== 'string') return `widget.order: phải là chuỗi các kênh phân tách bởi dấu phẩy.`;
  const ids = value.split(',').map(s => s.trim()).filter(Boolean);
  const sorted = [...ids].sort();
  const expected = [...WIDGET_CHANNEL_IDS].sort();
  if (sorted.length !== expected.length || sorted.some((id, i) => id !== expected[i])) {
    return `widget.order: phải chứa đúng 4 kênh (${WIDGET_CHANNEL_IDS.join(', ')}), mỗi kênh một lần.`;
  }
  return null;
}

export function validateWidgetKey(key, value) {
  if (key === 'widget.popup.title') return validateWidgetText(key, value, 60);
  if (key === 'widget.popup.description') return validateWidgetText(key, value, 120);
  if (key === 'widget.order') return validateWidgetOrder(value);
  const channelNameMatch = key.match(/^widget\.([^.]+)\.name$/);
  if (channelNameMatch) {
    if (!WIDGET_CHANNEL_IDS.includes(channelNameMatch[1])) return `${key}: kênh không được hỗ trợ.`;
    return validateWidgetText(key, value, 40);
  }
  const channelDescMatch = key.match(/^widget\.([^.]+)\.description$/);
  if (channelDescMatch) {
    if (!WIDGET_CHANNEL_IDS.includes(channelDescMatch[1])) return `${key}: kênh không được hỗ trợ.`;
    return validateWidgetText(key, value, 80);
  }
  const channelEnabledMatch = key.match(/^widget\.([^.]+)\.enabled$/);
  if (channelEnabledMatch) {
    if (!WIDGET_CHANNEL_IDS.includes(channelEnabledMatch[1])) return `${key}: kênh không được hỗ trợ.`;
    if (!['true', 'false'].includes(String(value))) return `${key}: giá trị phải là 'true' hoặc 'false'.`;
    return null;
  }
  // Any other widget.* key (e.g. the *Url fields) may only be written by the
  // dedicated upload/delete endpoints, never through the generic update().
  if (key.startsWith('widget.')) return `${key}: không thể ghi trực tiếp qua endpoint này.`;
  return null;
}
