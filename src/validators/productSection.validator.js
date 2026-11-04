export function productSectionError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function integer(value, label, min = 0) {
  const result = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < min) throw productSectionError(`${label} phải là số nguyên từ ${min}.`);
  return result;
}

export function sectionId(value) {
  return integer(value, 'ID khối', 1);
}

export function productId(value) {
  return integer(value, 'ID sản phẩm', 1);
}

export function validateSection(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
    throw productSectionError('Tên khối bắt buộc, tối đa 150 ký tự.');
  }
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 191) {
    throw productSectionError('Slug chỉ gồm chữ thường, số và dấu gạch ngang.');
  }
  const subtitle = typeof input.subtitle === 'string' ? input.subtitle.trim() : '';
  const viewAllUrl = typeof input.viewAllUrl === 'string' ? input.viewAllUrl.trim() : '';
  if (subtitle.length > 191) throw productSectionError('Tiêu đề phụ tối đa 191 ký tự.');
  if (viewAllUrl.length > 1000 || (viewAllUrl && !isSafeUrl(viewAllUrl))) throw productSectionError('Link Xem tất cả không hợp lệ.');
  return {
    type: 'PRODUCT_SECTION',
    name: input.name.trim(),
    slug,
    subtitle: subtitle || null,
    viewAllUrl: viewAllUrl || `/customer/products?section=${slug}`,
    sortOrder: integer(input.sortOrder ?? 0, 'Thứ tự'),
    isActive: input.isActive === false || input.isActive === 'false' ? false : true,
    showHighlightSpecs: input.showHighlightSpecs === false || input.showHighlightSpecs === 'false' ? false : true,
  };
}

const ALLOWED_PRESETS = ['dark-premium', 'ember-orange', 'light-minimal', 'image-background'];
const ALLOWED_LAYOUTS = ['text-left-cta-right', 'image-left', 'image-right'];
const ALLOWED_IMAGE_POS = ['left', 'right', 'background', 'none'];
const ALLOWED_CTA_STYLES = ['primary', 'outline'];
const ALLOWED_CTA_ROUNDED = ['rounded', 'pill'];

export function validatePromoSection(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
    throw productSectionError('Tên quản lý bắt buộc, tối đa 150 ký tự.');
  }
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 191) {
    throw productSectionError('Slug chỉ gồm chữ thường, số và dấu gạch ngang.');
  }
  const promoTitle = typeof input.promoTitle === 'string' ? input.promoTitle.trim() : '';
  if (promoTitle.length > 200) throw productSectionError('Tiêu đề hiển thị tối đa 200 ký tự.');
  const badge = typeof input.badge === 'string' ? input.badge.trim() : '';
  if (badge.length > 100) throw productSectionError('Badge tối đa 100 ký tự.');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const ctaLabel = typeof input.ctaLabel === 'string' ? input.ctaLabel.trim() : '';
  if (ctaLabel.length > 100) throw productSectionError('Nhãn CTA tối đa 100 ký tự.');
  const ctaUrl = typeof input.ctaUrl === 'string' ? input.ctaUrl.trim() : '';
  if (ctaUrl && !isSafeUrl(ctaUrl)) throw productSectionError('URL CTA không hợp lệ. Chỉ chấp nhận đường dẫn nội bộ hoặc https://.');
  if (ctaUrl.length > 1000) throw productSectionError('URL CTA tối đa 1000 ký tự.');
  const ctaStyle = ALLOWED_CTA_STYLES.includes(input.ctaStyle) ? input.ctaStyle : 'primary';
  const ctaRounded = ALLOWED_CTA_ROUNDED.includes(input.ctaRounded) ? input.ctaRounded : 'pill';
  const imageAlt = typeof input.imageAlt === 'string' ? input.imageAlt.trim() : '';
  if (imageAlt.length > 300) throw productSectionError('Alt text ảnh tối đa 300 ký tự.');
  const imagePos = ALLOWED_IMAGE_POS.includes(input.imagePos) ? input.imagePos : 'right';
  const colorPreset = ALLOWED_PRESETS.includes(input.colorPreset) ? input.colorPreset : 'dark-premium';
  const layout = ALLOWED_LAYOUTS.includes(input.layout) ? input.layout : 'text-left-cta-right';
  return {
    type: 'PROMOTIONAL_SECTION',
    name: input.name.trim(),
    slug,
    sortOrder: integer(input.sortOrder ?? 0, 'Thứ tự'),
    isActive: input.isActive === false || input.isActive === 'false' ? false : true,
    badge: badge || null,
    promoTitle: promoTitle || null,
    description: description || null,
    ctaEnabled: input.ctaEnabled === false || input.ctaEnabled === 'false' ? false : true,
    ctaLabel: ctaLabel || null,
    ctaUrl: ctaUrl || null,
    ctaStyle,
    ctaRounded,
    imageAlt: imageAlt || null,
    imagePos,
    colorPreset,
    layout,
  };
}

export function validateProductIds(input) {
  if (!Array.isArray(input?.productIds) || !input.productIds.length || input.productIds.length > 100) {
    throw productSectionError('Hãy chọn ít nhất một sản phẩm, tối đa 100 sản phẩm mỗi lần.');
  }
  const ids = input.productIds.map(productId);
  if (new Set(ids).size !== ids.length) throw productSectionError('Danh sách sản phẩm không được trùng nhau.');
  return ids;
}

export function validateReorderIds(input, label) {
  if (!Array.isArray(input?.ids) || input.ids.length > 500) throw productSectionError(`Danh sách sắp xếp ${label} không hợp lệ.`);
  const ids = input.ids.map(productId);
  if (new Set(ids).size !== ids.length) throw productSectionError('Danh sách sắp xếp không được trùng nhau.');
  return ids;
}

function isSafeUrl(value) {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

const FILTER_TYPES = ['ALL', 'BRAND', 'CATEGORY', 'ATTRIBUTE'];

export function validateQuickFilterConfig(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw productSectionError('Cấu hình Quick Filter không hợp lệ.');
  }
  const enabled = input.enabled === true || input.enabled === false ? input.enabled : true;
  if (!Array.isArray(input.tabs)) throw productSectionError('Danh sách tab không hợp lệ.');
  if (input.tabs.length > 20) throw productSectionError('Tối đa 20 tab cho một khối.');
  const tabs = input.tabs.map((tab, i) => {
    if (!tab || typeof tab !== 'object') throw productSectionError(`Tab ${i + 1} không hợp lệ.`);
    const id = typeof tab.id === 'string' && tab.id.trim() ? tab.id.trim() : null;
    if (!id) throw productSectionError(`Tab ${i + 1} thiếu id.`);
    const label = typeof tab.label === 'string' ? tab.label.trim() : '';
    if (!label || label.length > 50) throw productSectionError(`Tab ${i + 1}: tên hiển thị bắt buộc, tối đa 50 ký tự.`);
    const filterType = tab.filterType;
    if (!FILTER_TYPES.includes(filterType)) throw productSectionError(`Tab ${i + 1}: loại bộ lọc không hợp lệ.`);
    const out = { id, label, filterType, sortOrder: Number(tab.sortOrder ?? i) };
    if (filterType === 'BRAND') {
      if (!tab.brandId || !Number.isSafeInteger(Number(tab.brandId))) throw productSectionError(`Tab "${label}" thiếu brandId hợp lệ.`);
      out.brandId = Number(tab.brandId);
      out.brandSlug = typeof tab.brandSlug === 'string' ? tab.brandSlug.trim() : null;
    }
    if (filterType === 'CATEGORY') {
      if (!tab.categoryId || !Number.isSafeInteger(Number(tab.categoryId))) throw productSectionError(`Tab "${label}" thiếu categoryId hợp lệ.`);
      out.categoryId = Number(tab.categoryId);
      out.categorySlug = typeof tab.categorySlug === 'string' ? tab.categorySlug.trim() : null;
    }
    if (filterType === 'ATTRIBUTE') {
      if (!tab.attributeValueId || !Number.isSafeInteger(Number(tab.attributeValueId))) throw productSectionError(`Tab "${label}" thiếu attributeValueId hợp lệ.`);
      out.attributeValueId = Number(tab.attributeValueId);
      out.attributeId = tab.attributeId ? Number(tab.attributeId) : null;
      out.attributeSlug = typeof tab.attributeSlug === 'string' ? tab.attributeSlug.trim() : null;
    }
    return out;
  });
  return { enabled, tabs };
}
