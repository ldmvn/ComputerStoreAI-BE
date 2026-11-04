export function brandError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function integer(value, label, min = 0) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min) throw brandError(`${label} phải là số nguyên từ ${min}.`);
  return number;
}

export function brandId(value) { return integer(value, 'ID thương hiệu', 1); }

export function slugifyBrand(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseBrandPayload(input = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 191) throw brandError('Tên thương hiệu bắt buộc, tối đa 191 ký tự.');
  const slug = String(input.slug || slugifyBrand(name)).trim().toLowerCase();
  if (!slug || slug.length > 191 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw brandError('Đường dẫn chỉ gồm chữ thường, số và dấu gạch ngang.');
  const websiteUrl = typeof input.websiteUrl === 'string' ? input.websiteUrl.trim() || null : null;
  if (websiteUrl) {
    try {
      if (!['http:', 'https:'].includes(new URL(websiteUrl).protocol)) throw new Error();
    } catch { throw brandError('Website phải là URL bắt đầu bằng http:// hoặc https://.'); }
    if (websiteUrl.length > 1000) throw brandError('Website tối đa 1.000 ký tự.');
  }
  const description = typeof input.description === 'string' ? input.description.trim() || null : null;
  if (description && description.length > 10000) throw brandError('Mô tả tối đa 10.000 ký tự.');
  const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() || null : null;
  if (logoUrl && logoUrl.length > 1000) throw brandError('Đường dẫn logo tối đa 1.000 ký tự.');
  return { name, slug, logoUrl, websiteUrl, description, sortOrder: integer(input.sortOrder ?? 0, 'Thứ tự'), isActive: input.isActive === false || input.isActive === 'false' ? false : true };
}

export function parseBrandStatus(value) {
  if (value !== true && value !== false && value !== 'true' && value !== 'false') throw brandError('Trạng thái thương hiệu không hợp lệ.');
  return value === true || value === 'true';
}