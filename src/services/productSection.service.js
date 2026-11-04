import { prisma } from '../config/prisma.js';
import { productSectionError } from '../validators/productSection.validator.js';
import { removePromoImage } from './promoMedia.service.js';

const productSelect = { id: true, slug: true, sku: true, name: true, price: true, isActive: true, stockQuantity: true, images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { imageUrl: true }, take: 1 } };
const homeProductSelect = {
  ...productSelect,
  originalPrice: true,
  brandId: true,
  categoryId: true,
  attributeValues: {
    where: { attributeValueId: { not: null } },
    select: { attributeValueId: true },
  },
  specifications: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, value: true, sortOrder: true },
  },
  highlightSpecs: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, content: true, sortOrder: true },
  },
};
const sectionInclude = {
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { product: { select: productSelect } },
  },
};
const homeSectionInclude = {
  items: {
    where: { product: { isDeleted: false, isActive: true } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { product: { select: homeProductSelect } },
  },
};

function serialize(section) {
  return {
    id: section.id,
    type: section.type ?? 'PRODUCT_SECTION',
    name: section.name,
    slug: section.slug,
    subtitle: section.subtitle,
    viewAllUrl: section.viewAllUrl,
    sortOrder: section.sortOrder,
    isActive: section.isActive,
    showHighlightSpecs: section.showHighlightSpecs ?? true,
    quickFilterConfig: section.quickFilterConfig ?? null,
    // Promotional fields
    badge: section.badge ?? null,
    promoTitle: section.promoTitle ?? null,
    description: section.description ?? null,
    ctaEnabled: section.ctaEnabled ?? true,
    ctaLabel: section.ctaLabel ?? null,
    ctaUrl: section.ctaUrl ?? null,
    ctaStyle: section.ctaStyle ?? 'primary',
    ctaRounded: section.ctaRounded ?? 'pill',
    imageUrl: section.imageUrl ?? null,
    imageAlt: section.imageAlt ?? null,
    imagePos: section.imagePos ?? 'right',
    colorPreset: section.colorPreset ?? 'dark-premium',
    layout: section.layout ?? 'text-left-cta-right',
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    products: section.items.map(item => ({
      id: item.product.id,
      slug: item.product.slug,
      sku: item.product.sku,
      name: item.product.name,
      price: item.product.price,
      originalPrice: item.product.originalPrice,
      isActive: item.product.isActive,
      stockQuantity: item.product.stockQuantity,
      brandId: item.product.brandId ?? null,
      categoryId: item.product.categoryId ?? null,
      attributeValueIds: item.product.attributeValues?.map(pav => pav.attributeValueId).filter(Boolean) ?? [],
      specifications: item.product.specifications,
      highlightSpecs: item.product.highlightSpecs,
      primaryImage: item.product.images?.[0]?.imageUrl || null,
      sortOrder: item.sortOrder,
    })),
  };
}

export async function saveQuickFilterConfig(id, config) {
  await getSectionOrThrow(id);
  if (config?.tabs?.length) {
    const brandIds = [...new Set(config.tabs.filter(t => t.filterType === 'BRAND' && t.brandId).map(t => t.brandId))];
    const categoryIds = [...new Set(config.tabs.filter(t => t.filterType === 'CATEGORY' && t.categoryId).map(t => t.categoryId))];
    const attrValueIds = [...new Set(config.tabs.filter(t => t.filterType === 'ATTRIBUTE' && t.attributeValueId).map(t => t.attributeValueId))];
    if (brandIds.length) {
      const found = await prisma.brand.count({ where: { id: { in: brandIds } } });
      if (found !== brandIds.length) throw productSectionError('Một hoặc nhiều thương hiệu không tồn tại.', 422);
    }
    if (categoryIds.length) {
      const found = await prisma.category.count({ where: { id: { in: categoryIds } } });
      if (found !== categoryIds.length) throw productSectionError('Một hoặc nhiều danh mục không tồn tại.', 422);
    }
    if (attrValueIds.length) {
      const avRows = await prisma.attributeValue.findMany({ where: { id: { in: attrValueIds } }, select: { id: true, attributeId: true } });
      if (avRows.length !== attrValueIds.length) throw productSectionError('Một hoặc nhiều giá trị thuộc tính không tồn tại.', 422);
      for (const tab of config.tabs.filter(t => t.filterType === 'ATTRIBUTE' && t.attributeValueId && t.attributeId)) {
        const av = avRows.find(v => v.id === tab.attributeValueId);
        if (av && av.attributeId !== tab.attributeId) throw productSectionError(`Giá trị thuộc tính không thuộc thuộc tính đã chọn.`, 422);
      }
    }
  }
  const section = await prisma.productSection.update({
    where: { id },
    data: { quickFilterConfig: config },
    include: sectionInclude,
  });
  return serialize(section);
}

async function getSectionOrThrow(id) {
  const section = await prisma.productSection.findUnique({ where: { id }, include: sectionInclude });
  if (!section) throw productSectionError('Khối sản phẩm không tồn tại.', 404);
  return section;
}

export async function listSections() {
  const sections = await prisma.productSection.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: sectionInclude });
  return sections.map(serialize);
}

export async function getSection(id) {
  return serialize(await getSectionOrThrow(id));
}

export async function getHomeSections() {
  const sections = await prisma.productSection.findMany({
    where: {
      isActive: true,
      OR: [
        { type: 'PRODUCT_SECTION', items: { some: { product: { isDeleted: false, isActive: true } } } },
        { type: 'PROMOTIONAL_SECTION' },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: homeSectionInclude,
  });
  return sections.map(serialize);
}

export async function searchProducts(search = '') {
  const normalized = typeof search === 'string' ? search.trim() : '';
  return prisma.product.findMany({
    where: { isDeleted: false, ...(normalized ? { name: { contains: normalized } } : {}) },
    select: productSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 100,
  });
}

export async function createSection(data) {
  try {
    const section = await prisma.productSection.create({ data, include: sectionInclude });
    return serialize(section);
  } catch (error) {
    if (error.code === 'P2002') throw productSectionError('Slug khối sản phẩm đã tồn tại.', 409);
    throw error;
  }
}

export async function updateSection(id, data) {
  await getSectionOrThrow(id);
  try {
    const section = await prisma.productSection.update({ where: { id }, data, include: sectionInclude });
    return serialize(section);
  } catch (error) {
    if (error.code === 'P2002') throw productSectionError('Slug khối sản phẩm đã tồn tại.', 409);
    throw error;
  }
}

export async function setSectionStatus(id, isActive) {
  await getSectionOrThrow(id);
  return serialize(await prisma.productSection.update({ where: { id }, data: { isActive }, include: sectionInclude }));
}

export async function addProducts(id, productIds) {
  await getSectionOrThrow(id);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, isDeleted: false }, select: { id: true } });
  if (products.length !== productIds.length) throw productSectionError('Một hoặc nhiều sản phẩm không tồn tại.', 404);
  const existing = await prisma.productSectionItem.findMany({ where: { sectionId: id, productId: { in: productIds } }, select: { productId: true } });
  if (existing.length) throw productSectionError('Sản phẩm đã tồn tại trong khối này.', 409);
  const last = await prisma.productSectionItem.findFirst({ where: { sectionId: id }, orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }], select: { sortOrder: true } });
  const start = (last?.sortOrder ?? -1) + 1;
  await prisma.productSectionItem.createMany({ data: productIds.map((productId, index) => ({ sectionId: id, productId, sortOrder: start + index })) });
  return getSection(id);
}

export async function removeProduct(id, productId) {
  await getSectionOrThrow(id);
  const item = await prisma.productSectionItem.findUnique({ where: { sectionId_productId: { sectionId: id, productId } } });
  if (!item) throw productSectionError('Sản phẩm không nằm trong khối này.', 404);
  await prisma.productSectionItem.delete({ where: { id: item.id } });
  return getSection(id);
}

export async function reorderProducts(id, productIds) {
  await getSectionOrThrow(id);
  const current = await prisma.productSectionItem.findMany({ where: { sectionId: id }, select: { productId: true } });
  if (current.length !== productIds.length || current.some(item => !productIds.includes(item.productId))) {
    throw productSectionError('Danh sách sản phẩm đã thay đổi. Hãy tải lại rồi sắp xếp lại.', 409);
  }
  await prisma.$transaction(productIds.map((productId, sortOrder) => prisma.productSectionItem.update({ where: { sectionId_productId: { sectionId: id, productId } }, data: { sortOrder } })));
  return getSection(id);
}

export async function reorderSections(ids) {
  const current = await prisma.productSection.findMany({ select: { id: true } });
  if (current.length !== ids.length || current.some(section => !ids.includes(section.id))) {
    throw productSectionError('Danh sách khối đã thay đổi. Hãy tải lại rồi sắp xếp lại.', 409);
  }
  await prisma.$transaction(ids.map((id, sortOrder) => prisma.productSection.update({ where: { id }, data: { sortOrder } })));
  return listSections();
}

export async function updateSectionImage(id, imageUrl) {
  const current = await getSectionOrThrow(id);
  if (current.imageUrl) await removePromoImage(current.imageUrl);
  const section = await prisma.productSection.update({ where: { id }, data: { imageUrl }, include: sectionInclude });
  return serialize(section);
}

export async function deleteSectionImage(id) {
  const current = await getSectionOrThrow(id);
  if (current.imageUrl) await removePromoImage(current.imageUrl);
  const section = await prisma.productSection.update({ where: { id }, data: { imageUrl: null, imageAlt: null }, include: sectionInclude });
  return serialize(section);
}

export async function deleteSection(id) {
  const current = await getSectionOrThrow(id);
  if (current.imageUrl) await removePromoImage(current.imageUrl);
  await prisma.productSection.delete({ where: { id } });
}
