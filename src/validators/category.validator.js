export function categoryError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function integer(value, label, min = 0) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min) throw categoryError(`${label} phải là số nguyên từ ${min}.`);
  return number;
}

export function categoryId(value) { return integer(value, 'ID danh mục', 1); }

export function slugifyCategory(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseCategoryPayload(input = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 191) throw categoryError('Tên danh mục bắt buộc, tối đa 191 ký tự.');
  const slug = String(input.slug || slugifyCategory(name)).trim().toLowerCase();
  if (!slug || slug.length > 191 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw categoryError('Đường dẫn chỉ gồm chữ thường, số và dấu gạch ngang.');
  const icon = typeof input.icon === 'string' ? input.icon.trim() || null : null;
  if (icon && !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(icon)) throw categoryError('Icon không hợp lệ.');
  const parentId = input.parentId === '' || input.parentId === undefined || input.parentId === null ? null : integer(input.parentId, 'Danh mục cha', 1);
  const sortOrder = integer(input.sortOrder ?? 0, 'Thứ tự');
  const description = typeof input.description === 'string' ? input.description.trim() || null : null;
  if (description && description.length > 10000) throw categoryError('Mô tả tối đa 10.000 ký tự.');
  return { name, slug, icon, parentId, sortOrder, description, isActive: input.isActive === false || input.isActive === 'false' ? false : true };
}

export function parseCategoryListQuery(query = {}) {
  const search = String(query.search || '').trim();
  const status = ['active', 'inactive'].includes(query.status) ? query.status : '';
  const type = ['root', 'child'].includes(query.type) ? query.type : '';
  const sort = query.sort === 'name' || query.sort === 'updated' ? query.sort : 'order';
  return { search, status, type, sort };
}

export function parseCategoryStatus(value) {
  if (value !== true && value !== false && value !== 'true' && value !== 'false') throw categoryError('Trạng thái danh mục không hợp lệ.');
  return value === true || value === 'true';
}

export function parseCategoryOrder(value) { return integer(value, 'Thứ tự'); }