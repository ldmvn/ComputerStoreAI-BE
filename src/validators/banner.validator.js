export const MAIN_POSITIONS = ['MAIN_HERO'];
export const SIDE_POSITIONS = ['SIDE_LEFT', 'SIDE_RIGHT_TOP', 'SIDE_RIGHT_MIDDLE', 'SIDE_RIGHT_BOTTOM', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'];
export const POSITIONS = [...MAIN_POSITIONS, ...SIDE_POSITIONS];
export const AUTO_SIDE_ORDER = ['BOTTOM_LEFT', 'BOTTOM_RIGHT', 'SIDE_RIGHT_TOP', 'SIDE_RIGHT_MIDDLE', 'SIDE_RIGHT_BOTTOM', 'SIDE_LEFT'];

export function bannerError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function integer(value, label, min, max) {
  const result = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw bannerError(`${label} phải từ ${min} đến ${max}.`);
  return result;
}

export function bannerId(value) {
  return integer(value, 'ID banner', 1, 2147483647);
}

export function activeValue(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw bannerError('Trạng thái phải là Active hoặc Inactive.');
}

export function validateBanner(input) {
  const { name, group, position, mediaType } = input;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 150) throw bannerError('Tên banner bắt buộc, tối đa 150 ký tự.');
  if (!['MAIN', 'SIDE'].includes(group)) throw bannerError('Nhóm banner không hợp lệ.');
  if (!(group === 'SIDE' && position === 'AUTO') && !(group === 'MAIN' ? MAIN_POSITIONS : SIDE_POSITIONS).includes(position)) throw bannerError('Vị trí không thuộc nhóm banner đã chọn.');
  if (!['IMAGE', 'VIDEO'].includes(mediaType)) throw bannerError('Loại media phải là Image hoặc Video.');
  const targetUrl = typeof input.targetUrl === 'string' ? input.targetUrl.trim() : '';
  if (targetUrl.length > 1000 || (targetUrl && !isSafeTarget(targetUrl))) throw bannerError('Link phải là đường dẫn nội bộ bắt đầu bằng / hoặc URL http/https hợp lệ.');
  const altText = typeof input.altText === 'string' ? input.altText.trim() : '';
  if (altText.length > 300) throw bannerError('Alt text tối đa 300 ký tự.');
  return {
    name: name.trim(), group, position, mediaType, targetUrl: targetUrl || null, altText,
    isAutoPlaced: group === 'SIDE' && position === 'AUTO',
    sortOrder: integer(input.sortOrder ?? 0, 'Thứ tự', 0, 1000000),
    autoplayInterval: integer(input.autoplayInterval ?? 4500, 'Thời gian chuyển (ms)', 1000, 60000),
    isActive: activeValue(input.isActive ?? true),
  };
}

export function isSafeTarget(value) {
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateReorder(input) {
  if (!POSITIONS.includes(input.position) || !Array.isArray(input.ids) || input.ids.length > 500) throw bannerError('Danh sách sắp xếp không hợp lệ.');
  const ids = input.ids.map(bannerId);
  if (new Set(ids).size !== ids.length) throw bannerError('ID banner không được trùng nhau.');
  return { position: input.position, ids };
}
