export const attributeError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function positiveId(value, label = 'ID') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw attributeError(`${label} không hợp lệ.`);
  return id;
}

function integer(value, label) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw attributeError(`${label} phải là số nguyên từ 0.`);
  return parsed;
}

function boolean(value, fallback = true) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw attributeError('Trạng thái không hợp lệ.');
}

function optionalString(value, label, maxLen) {
  if (value === undefined || value === null || value === '') return undefined;
  const str = String(value).trim();
  if (str.length > maxLen) throw attributeError(`${label} tối đa ${maxLen} ký tự.`);
  return str || undefined;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseAttribute(input = {}) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const type = String(input.type || '').trim();
  if (!name || name.length > 191) throw attributeError('Tên thuộc tính là bắt buộc và tối đa 191 ký tự.');
  if (!slugPattern.test(slug)) throw attributeError('Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang.');
  if (!['SELECT', 'MULTI_SELECT', 'TEXT', 'NUMBER', 'BOOLEAN'].includes(type)) throw attributeError('Loại thuộc tính không hợp lệ.');
  return {
    name, slug, type,
    sortOrder:    integer(input.sortOrder, 'Thứ tự'),
    isActive:     boolean(input.isActive),
    unit:         optionalString(input.unit, 'Đơn vị', 32),
    description:  optionalString(input.description, 'Mô tả', 500),
    showInDetail: boolean(input.showInDetail, true),
    usedInFilter: boolean(input.usedInFilter, false),
    usedInBuildPC: boolean(input.usedInBuildPC, false),
  };
}

export function parseValue(input = {}) {
  const value = String(input.value || '').trim();
  if (!value || value.length > 500) throw attributeError('Giá trị là bắt buộc và tối đa 500 ký tự.');
  return { value, sortOrder: integer(input.sortOrder, 'Thứ tự'), isActive: boolean(input.isActive) };
}

export function parseCategoryIds(input = {}) {
  if (!Array.isArray(input.categoryIds)) throw attributeError('Danh sách danh mục không hợp lệ.');
  return [...new Set(input.categoryIds.map(value => positiveId(value, 'Danh mục')))];
}

// Rich category-link input: [{ categoryId, isRequired, showInForm, showInDetail, usedInFilter, requiredForBuildPC, sortOrder }]
export function parseCategoryLinks(input = {}) {
  if (!Array.isArray(input.links)) throw attributeError('Danh sách liên kết danh mục không hợp lệ.');
  const seen = new Set();
  return input.links.map(link => {
    const categoryId = positiveId(link?.categoryId, 'Danh mục');
    if (seen.has(categoryId)) throw attributeError(`Danh mục ID ${categoryId} bị trùng.`);
    seen.add(categoryId);
    return {
      categoryId,
      sortOrder:          integer(link.sortOrder, 'Thứ tự'),
      isRequired:         boolean(link.isRequired, false),
      showInForm:         boolean(link.showInForm, true),
      showInDetail:       boolean(link.showInDetail, true),
      usedInFilter:       boolean(link.usedInFilter, true),
      requiredForBuildPC: boolean(link.requiredForBuildPC, false),
    };
  });
}

// AttributeGroup validators
export function parseGroup(input = {}) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!name || name.length > 191) throw attributeError('Tên nhóm là bắt buộc và tối đa 191 ký tự.');
  if (!slugPattern.test(slug)) throw attributeError('Slug nhóm chỉ gồm chữ thường không dấu, số và dấu gạch ngang.');
  return {
    name, slug,
    description: optionalString(input.description, 'Mô tả nhóm', 500),
    icon:        optionalString(input.icon, 'Icon', 64),
    sortOrder:   integer(input.sortOrder, 'Thứ tự'),
    isActive:    boolean(input.isActive),
  };
}

// Group members: [{ attributeId, sortOrder }]
export function parseGroupMembers(input = {}) {
  if (!Array.isArray(input.members)) throw attributeError('Danh sách thuộc tính nhóm không hợp lệ.');
  const seen = new Set();
  return input.members.map(m => {
    const attributeId = positiveId(m?.attributeId, 'Thuộc tính');
    if (seen.has(attributeId)) throw attributeError(`Thuộc tính ID ${attributeId} bị trùng.`);
    seen.add(attributeId);
    return { attributeId, sortOrder: integer(m?.sortOrder, 'Thứ tự') };
  });
}

export const parseStatus = value => boolean(value);
export const parseOrder = value => integer(value, 'Thứ tự');
