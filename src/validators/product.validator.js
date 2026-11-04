export function productError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function int(value, label, min = 0) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min) throw productError(`${label} phải là số nguyên từ ${min}.`);
  return number;
}

export function productId(value) { return int(value, 'ID sản phẩm', 1); }

export function parseProductPayload(input = {}) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const sku = String(input.sku || '').trim().toUpperCase();
  if (!name || name.length > 191) throw productError('Tên sản phẩm bắt buộc, tối đa 191 ký tự.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw productError('Slug chỉ gồm chữ thường, số và dấu gạch ngang.');
  if (sku && !/^[A-Z0-9][A-Z0-9._-]{1,99}$/.test(sku)) throw productError('Mã SP chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới (tối đa 100 ký tự).');
  const price = int(input.price, 'Giá bán');
  const optionalMoney = (value, label) => value === '' || value === undefined || value === null ? null : int(value, label);
  const originalPrice = optionalMoney(input.originalPrice, 'Giá gốc');
  const costPrice = optionalMoney(input.costPrice, 'Giá nhập');
  const stockQuantity = int(input.stockQuantity ?? 0, 'Tồn kho');
  const lowStockThreshold = int(input.lowStockThreshold ?? 5, 'Ngưỡng sắp hết');
  const categoryId = input.categoryId === '' || input.categoryId === undefined || input.categoryId === null ? null : int(input.categoryId, 'ID danh mục', 1);
  const brandId = input.brandId === '' || input.brandId === undefined || input.brandId === null ? null : int(input.brandId, 'ID thương hiệu', 1);
  const subtitle = value => typeof value === 'string' ? value.trim() || null : null;
  let productAttributes = [];
  if (input.productAttributes) {
    try { productAttributes = typeof input.productAttributes === 'string' ? JSON.parse(input.productAttributes) : input.productAttributes; } catch { throw productError('Dữ liệu thuộc tính sản phẩm không hợp lệ.'); }
  }
  if (!Array.isArray(productAttributes) || productAttributes.length > 100) throw productError('Danh sách thuộc tính sản phẩm không hợp lệ.');
  productAttributes = productAttributes.map(item => {
    const attributeId = int(item?.attributeId, 'ID thuộc tính', 1);
    if (!Array.isArray(item?.attributeValueIds ?? [])) throw productError('Giá trị thuộc tính không hợp lệ.');
    const attributeValueIds = (item?.attributeValueIds ?? []).map(value => int(value, 'ID giá trị thuộc tính', 1));
    const valueText = item?.valueText == null ? null : String(item.valueText).trim();
    if (valueText && valueText.length > 1000) throw productError('Giá trị thuộc tính tối đa 1000 ký tự.');
    return { attributeId, attributeValueIds: [...new Set(attributeValueIds)], valueText };
  });
  let customSpecifications = [];
  if (input.customSpecifications) {
    try { customSpecifications = typeof input.customSpecifications === 'string' ? JSON.parse(input.customSpecifications) : input.customSpecifications; } catch { throw productError('Thông số tự do không hợp lệ.'); }
  }
  if (!Array.isArray(customSpecifications) || customSpecifications.length > 100) throw productError('Danh sách thông số tự do không hợp lệ.');
  customSpecifications = customSpecifications.map((item, index) => {
    const specName = String(item?.name || '').trim(); const value = String(item?.value || '').trim();
    if (!specName || !value || specName.length > 100 || value.length > 500) throw productError('Tên và giá trị thông số tự do không được để trống.');
    const orderRaw = item?.sortOrder;
    const order = orderRaw === undefined || orderRaw === null || orderRaw === '' ? index : int(orderRaw, 'Thứ tự thông số tự do', 0);
    return { name: specName, value, sortOrder: order };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
  let highlightSpecs = [];
  if (input.highlightSpecs) {
    try { highlightSpecs = typeof input.highlightSpecs === 'string' ? JSON.parse(input.highlightSpecs) : input.highlightSpecs; } catch { throw productError('Thông số nổi bật không hợp lệ.'); }
  }
  if (!Array.isArray(highlightSpecs) || highlightSpecs.length > 12) throw productError('Danh sách thông số nổi bật không hợp lệ (tối đa 12 dòng).');
  highlightSpecs = highlightSpecs.map((item, index) => {
    const content = String(item?.content ?? item?.value ?? '').trim();
    if (!content || content.length > 500) throw productError('Nội dung thông số nổi bật không được để trống và tối đa 500 ký tự.');
    const orderRaw = item?.sortOrder;
    const order = orderRaw === undefined || orderRaw === null || orderRaw === '' ? index : int(orderRaw, 'Thứ tự thông số nổi bật', 0);
    return { content, sortOrder: order };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
  const isActive = input.isActive === false || input.isActive === 'false' ? false : true;
  const keepImageIds = input.keepImageIds === undefined ? undefined : (typeof input.keepImageIds === 'string' ? JSON.parse(input.keepImageIds) : input.keepImageIds);
  if (keepImageIds !== undefined && (!Array.isArray(keepImageIds) || keepImageIds.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1))) throw productError('Danh sách ảnh giữ lại không hợp lệ.');
  const imageOrderIds = input.imageOrderIds === undefined ? keepImageIds : (typeof input.imageOrderIds === 'string' ? JSON.parse(input.imageOrderIds) : input.imageOrderIds);
  if (imageOrderIds !== undefined && (!Array.isArray(imageOrderIds) || imageOrderIds.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1))) throw productError('Thứ tự ảnh không hợp lệ.');
  return {
    name, slug, sku, category: subtitle(input.category), categoryId, brand: subtitle(input.brand), brandId, shortDescription: subtitle(input.shortDescription), description: subtitle(input.description),
    price, originalPrice, costPrice, stockQuantity, lowStockThreshold, isActive, customSpecifications, productAttributes, highlightSpecs, keepImageIds: keepImageIds?.map(Number), imageOrderIds: imageOrderIds?.map(Number),
  };
}

const MAX_ATTRIBUTE_FILTERS = 20;
const MAX_VALUES_PER_ATTRIBUTE = 50;

// Accepts `?attr[socket]=12` / `?attr[socket]=12,17` (AND across attributes, OR within one)
// and the legacy `?attribute=socket&attributeValue=12` single pair.
export function parseAttributeFilters(query = {}) {
  const collected = new Map();
  const add = (rawSlug, rawValues) => {
    const slug = String(rawSlug || '').trim();
    if (!slug || slug.length > 100) throw productError('Bộ lọc thuộc tính không hợp lệ.');
    const values = (Array.isArray(rawValues) ? rawValues : String(rawValues ?? '').split(','))
      .map(value => String(value).trim())
      .filter(Boolean);
    if (!values.length) throw productError('Bộ lọc thuộc tính không hợp lệ.');
    if (values.some(value => value.length > 500)) throw productError('Bộ lọc thuộc tính không hợp lệ.');
    const merged = collected.get(slug) || new Set();
    for (const value of values) merged.add(value);
    if (merged.size > MAX_VALUES_PER_ATTRIBUTE) throw productError('Bộ lọc thuộc tính có quá nhiều giá trị.');
    collected.set(slug, merged);
  };

  const attr = query.attr;
  if (attr !== undefined) {
    if (typeof attr !== 'object' || Array.isArray(attr)) throw productError('Bộ lọc thuộc tính không hợp lệ.');
    for (const [slug, values] of Object.entries(attr)) add(slug, values);
  }

  const legacySlug = String(query.attribute || '').trim();
  const legacyValue = String(query.attributeValue || '').trim();
  if (Boolean(legacySlug) !== Boolean(legacyValue)) throw productError('Bộ lọc thuộc tính không hợp lệ.');
  if (legacySlug) add(legacySlug, legacyValue);

  if (collected.size > MAX_ATTRIBUTE_FILTERS) throw productError('Quá nhiều bộ lọc thuộc tính.');
  return [...collected.entries()].map(([slug, values]) => ({ slug, values: [...values] }));
}

export function parseProductListQuery(query = {}) {
  const brandId = query.brandId === undefined || query.brandId === '' ? undefined : int(query.brandId, 'ID thương hiệu', 1);
  if (brandId !== undefined && brandId > 2147483647) throw productError('ID thương hiệu không hợp lệ.');
  const price = (value, label) => value === undefined || value === '' ? undefined : int(value, label);
  const minPrice = price(query.minPrice, 'Giá tối thiểu');
  const maxPrice = price(query.maxPrice, 'Giá tối đa');
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) throw productError('Khoảng giá không hợp lệ.');
  const attributeFilters = parseAttributeFilters(query);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  const sortMap = { newest: [{ updatedAt: 'desc' }], oldest: [{ createdAt: 'asc' }], priceAsc: [{ price: 'asc' }], priceDesc: [{ price: 'desc' }], nameAsc: [{ name: 'asc' }], nameDesc: [{ name: 'desc' }], stockAsc: [{ stockQuantity: 'asc' }], stockDesc: [{ stockQuantity: 'desc' }] };
  // `attribute`/`attributeValue` stay on the result for existing callers; `attributeFilters` is the
  // normalized list the query builder reads.
  return { page, limit, minPrice, maxPrice, attributeFilters, attribute: String(query.attribute || '').trim(), attributeValue: String(query.attributeValue || '').trim(), brandId, search: String(query.search || '').trim(), category: String(query.category || '').trim(), brand: String(query.brand || '').trim(), status: String(query.status || '').trim(), stock: String(query.stock || '').trim(), sectionSlug: String(query.section || '').trim(), orderBy: sortMap[query.sort] || sortMap.newest };
}

// Filter metadata is scoped by browsing context only (category + search), never by the
// active brand/attribute selections — otherwise the option lists collapse to the current result.
export function parseFilterContextQuery(query = {}) {
  return { category: String(query.category || '').trim(), search: String(query.search || '').trim(), sectionSlug: String(query.section || '').trim(), status: 'active' };
}
