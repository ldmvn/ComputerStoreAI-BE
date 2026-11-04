export const menuError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function menuInt(value, label = 'ID', min = 1, max = 2147483647) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean' || !/^\d+$/.test(String(value))) throw menuError(`${label} không hợp lệ.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw menuError(`${label} không hợp lệ.`);
  return n;
}
const text = (value, label, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw menuError(`${label} bắt buộc, tối đa ${max} ký tự.`);
  return value.trim();
};
export function active(value = true) {
  if (typeof value !== 'boolean') throw menuError('Trạng thái phải là boolean.');
  return value;
}
export function safeMenuUrl(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
export function parseGroup(input = {}) {
  return { title: text(input.title, 'Tên nhóm', 191), sortOrder: menuInt(input.sortOrder ?? 0, 'Thứ tự', 0), columnSpan: menuInt(input.columnSpan ?? 1, 'Column span', 1, 4), isActive: active(input.isActive) };
}
export function parseItem(input = {}) {
  const data = { label: text(input.label, 'Tên hiển thị', 191), type: input.type, sortOrder: menuInt(input.sortOrder ?? 0, 'Thứ tự', 0), isActive: active(input.isActive), categoryId: null, brandId: null, attributeId: null, attributeValueId: null, attributeName: null, attributeValue: null, minPrice: null, maxPrice: null, customUrl: null };
  if (data.type === 'CATEGORY') data.categoryId = menuInt(input.categoryId, 'Danh mục');
  else if (data.type === 'BRAND') data.brandId = menuInt(input.brandId, 'Thương hiệu');
  else if (data.type === 'PRICE_FILTER') {
    data.minPrice = input.minPrice === '' || input.minPrice == null ? null : menuInt(input.minPrice, 'Giá tối thiểu', 0);
    data.maxPrice = input.maxPrice === '' || input.maxPrice == null ? null : menuInt(input.maxPrice, 'Giá tối đa', 0);
    if (data.minPrice === null && data.maxPrice === null) throw menuError('Nhập ít nhất một giới hạn giá.');
    if (data.minPrice !== null && data.maxPrice !== null && data.minPrice > data.maxPrice) throw menuError('Giá tối thiểu không được lớn hơn giá tối đa.');
  } else if (data.type === 'ATTRIBUTE_FILTER') {
    data.attributeId = menuInt(input.attributeId, 'Thuộc tính');
    data.attributeValueId = menuInt(input.attributeValueId, 'Giá trị thuộc tính');
  } else if (data.type === 'CUSTOM_URL') {
    if (!safeMenuUrl(input.customUrl)) throw menuError('URL phải là đường dẫn nội bộ hoặc URL http/https hợp lệ.');
    data.customUrl = input.customUrl;
  } else throw menuError('Loại mục không hợp lệ.');
  return data;
}
