import { prisma } from '../config/prisma.js';
import { productError } from '../validators/product.validator.js';
import { removeProductImage } from './productMedia.service.js';
import { resolveBrandFilter } from './brand.service.js';
import { getProductStatistics } from './productStatistics.service.js';
import { generateProductSkuForCategoryId } from './productSku.service.js';
import { getActivePromotionsForProduct } from './promotion.service.js';

const imageOrder = [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }];
const detailInclude = { images: { orderBy: imageOrder }, specifications: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }, attributeValues: { include: { attribute: true, attributeValue: true }, orderBy: { id: 'asc' } }, highlightSpecs: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }, brandRecord: true, categoryRecord: { select: { id: true, name: true, slug: true } } };
const listInclude = { images: { orderBy: imageOrder, take: 1 }, brandRecord: true };

function serialize(product, detail = false, publicView = false) {
  const primary = product.images?.find(image => image.isPrimary) || product.images?.[0] || null;
  const normalized = new Map();
  for (const row of product.attributeValues || []) {
    const current = normalized.get(row.attributeId) || { id: row.attributeId, name: row.attribute.name, slug: row.attribute.slug, type: row.attribute.type, unit: row.attribute.unit, sortOrder: row.attribute.sortOrder, valueIds: [], values: [] };
    if (row.attributeValue) { current.valueIds.push(row.attributeValue.id); current.values.push(row.attributeValue.value); }
    else if (row.valueText !== null) current.values.push(row.attribute.type === 'BOOLEAN' ? (row.valueText === 'true' ? 'Có' : 'Không') : row.valueText);
    normalized.set(row.attributeId, current);
  }
  const productAttributes = [...normalized.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return {
    id: product.id, name: product.name, slug: product.slug, sku: product.sku, category: product.categoryRecord?.name || product.category, categoryId: product.categoryId, categoryInfo: product.categoryRecord || null, brandId: product.brandId, brand: product.brandRecord?.name || product.brand, brandInfo: product.brandRecord ? { id: product.brandRecord.id, name: product.brandRecord.name, slug: product.brandRecord.slug, logoUrl: product.brandRecord.logoUrl } : null,
    shortDescription: product.shortDescription, description: detail ? product.description : undefined, price: product.price,
    originalPrice: product.originalPrice, costPrice: detail && !publicView ? product.costPrice : undefined, stockQuantity: product.stockQuantity,
    lowStockThreshold: product.lowStockThreshold, isActive: product.isActive, isDeleted: product.isDeleted,
    stockStatus: product.stockQuantity === 0 ? 'OUT_OF_STOCK' : product.stockQuantity <= product.lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK',
    primaryImage: primary?.imageUrl || null, images: detail ? product.images : undefined, customSpecifications: detail ? (product.specifications || []) : undefined, productAttributes: detail ? productAttributes : undefined, highlightSpecs: detail ? product.highlightSpecs : undefined,
    createdAt: product.createdAt, updatedAt: product.updatedAt,
  };
}

export async function whereForQuery(filters, resolvedBrand) {
  const where = { isDeleted: false };
  const conditions = [];
  if (filters.search) conditions.push({ OR: [{ name: { contains: filters.search } }, { sku: { contains: filters.search } }, { slug: { contains: filters.search } }] });
  if (filters.category) {
    const category = await prisma.category.findUnique({ where: { slug: filters.category }, select: { id: true, name: true } });
    if (category) {
      const categories = await prisma.category.findMany({ select: { id: true, parentId: true, name: true } });
      const ids = new Set([category.id]);
      let changed = true;
      while (changed) { changed = false; for (const row of categories) if (ids.has(row.parentId) && !ids.has(row.id)) { ids.add(row.id); changed = true; } }
      conditions.push({ OR: [{ categoryId: { in: [...ids] } }, { categoryId: null, category: { in: categories.filter(row => ids.has(row.id)).map(row => row.name) } }] });
    } else conditions.push({ category: filters.category });
  }
  if (filters.sectionSlug) conditions.push({ sectionItems: { some: { section: { slug: filters.sectionSlug } } } });
  if (filters.brand || filters.brandId) conditions.push(resolvedBrand
    ? { OR: [{ brandId: resolvedBrand.id }, { brandId: null, brand: resolvedBrand.name }] }
    : { id: -1 });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) where.price = { ...(filters.minPrice === undefined ? {} : { gte: filters.minPrice }), ...(filters.maxPrice === undefined ? {} : { lte: filters.maxPrice }) };
  // Each attribute filter is its own condition, so different attributes combine with AND
  // while the values inside one attribute combine with OR.
  for (const filter of filters.attributeFilters || []) {
    const ids = filter.values.map(Number).filter(Number.isSafeInteger);
    conditions.push({ OR: [
      { attributeValues: { some: {
        attribute: { OR: [{ slug: filter.slug }, { name: filter.slug }], isActive: true },
        OR: [
          ...(ids.length ? [{ attributeValue: { id: { in: ids }, isActive: true } }] : []),
          { attributeValue: { value: { in: filter.values }, isActive: true } },
          { valueText: { in: filter.values } },
        ],
      } } },
      { specifications: { some: { name: filter.slug, value: { in: filter.values } } } },
    ] });
  }
  if (conditions.length) where.AND = conditions;
  if (filters.status === 'active') where.isActive = true;
  if (filters.status === 'inactive') where.isActive = false;
  if (filters.status === 'outOfStock' || filters.stock === 'out') where.stockQuantity = 0;
  if (filters.stock === 'low') where.stockQuantity = { gt: 0, lte: 5 };
  return where;
}

async function getByIdOrThrow(id, detail = true) {
  const product = await prisma.product.findFirst({ where: { id, isDeleted: false }, include: detail ? detailInclude : listInclude });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);
  return product;
}

async function resolveProductCategory(payload) {
  if (payload.categoryId === null) return { categoryId: null, category: payload.category };
  const category = await prisma.category.findUnique({ where: { id: payload.categoryId }, select: { id: true, name: true } });
  if (!category) throw productError('Danh mục sản phẩm không tồn tại.', 400);
  return { categoryId: category.id, category: category.name };
}

async function resolveProductBrand(payload) {
  if (payload.brandId === null) {
    if (!payload.brand) return { brandId: null, brand: null };
    const existing = await prisma.brand.findFirst({ where: { name: payload.brand }, select: { id: true, name: true } });
    return existing ? { brandId: existing.id, brand: existing.name } : { brandId: null, brand: payload.brand };
  }
  const brand = await prisma.brand.findUnique({ where: { id: payload.brandId }, select: { id: true, name: true } });
  if (!brand) throw productError('Thương hiệu sản phẩm không tồn tại.', 400);
  return { brandId: brand.id, brand: brand.name };
}

async function replaceProductAttributes(tx, productId, categoryId, entries) {
  await tx.productAttributeValue.deleteMany({ where: { productId } });
  entries ||= [];

  if (categoryId) {
    // Validate required fields (showInForm=true AND isRequired=true must have a value)
    const requiredLinks = await tx.categoryAttribute.findMany({
      where: { categoryId, isRequired: true, showInForm: true, attribute: { isActive: true } },
      include: { attribute: { select: { id: true, name: true, type: true } } },
    });
    if (requiredLinks.length) {
      const entryMap = new Map(entries.map(e => [e.attributeId, e]));
      for (const link of requiredLinks) {
        const entry = entryMap.get(link.attributeId);
        const hasValue = entry && (
          ['SELECT', 'MULTI_SELECT'].includes(link.attribute.type)
            ? (entry.attributeValueIds || []).length > 0
            : (entry.valueText !== null && entry.valueText !== '')
        );
        if (!hasValue) throw productError(`Thuộc tính “${link.attribute.name}” là bắt buộc.`);
      }
    }
  }

  if (!entries.length) return;
  const attributes = await tx.attribute.findMany({ where: { id: { in: entries.map(item => item.attributeId) }, categories: { some: { categoryId } } }, include: { values: true } });
  const byId = new Map(attributes.map(attribute => [attribute.id, attribute]));
  const rows = [];
  for (const entry of entries) {
    const attribute = byId.get(entry.attributeId);
    if (!attribute) throw productError('Thuộc tính không thuộc danh mục sản phẩm hoặc không tồn tại.');
    if (['SELECT', 'MULTI_SELECT'].includes(attribute.type)) {
      const selected = entry.attributeValueIds || [];
      if (attribute.type === 'SELECT' && selected.length > 1) throw productError(`Thuộc tính “${attribute.name}” chỉ được chọn một giá trị.`);
      const valid = new Set(attribute.values.filter(value => value.isActive).map(value => value.id));
      if (selected.some(id => !valid.has(id))) throw productError(`Giá trị của thuộc tính “${attribute.name}” không hợp lệ.`);
      rows.push(...selected.map(attributeValueId => ({ productId, attributeId: attribute.id, attributeValueId })));
    } else if (entry.valueText !== null && entry.valueText !== '') {
      if (attribute.type === 'NUMBER' && !Number.isFinite(Number(entry.valueText))) throw productError(`Thuộc tính “${attribute.name}” phải là số.`);
      if (attribute.type === 'BOOLEAN' && !['true', 'false'].includes(entry.valueText)) throw productError(`Thuộc tính “${attribute.name}” phải là Có/Không.`);
      const row = { productId, attributeId: attribute.id, valueText: entry.valueText };
      if (attribute.type === 'NUMBER') row.valueNumber = Number(entry.valueText);
      rows.push(row);
    }
  }
  if (rows.length) await tx.productAttributeValue.createMany({ data: rows });
}

function mapUniqueError(error) {
  if (error.code !== 'P2002') throw error;
  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
  throw productError(target.includes('sku') ? 'SKU đã tồn tại.' : 'Slug đã tồn tại.', 409);
}

export async function listProducts(filters) {
  const resolvedBrand = await resolveBrandFilter(filters);
  const where = await whereForQuery(filters, resolvedBrand);
  const skip = (filters.page - 1) * filters.limit;
  const [rows, total, active, outOfStock, inactive] = await Promise.all([
    prisma.product.findMany({ where, include: listInclude, orderBy: filters.orderBy, skip, take: filters.limit }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { isDeleted: false, isActive: true } }),
    prisma.product.count({ where: { isDeleted: false, stockQuantity: 0 } }),
    prisma.product.count({ where: { isDeleted: false, isActive: false } }),
  ]);
  return { filters: { brand: resolvedBrand }, items: rows.map(product => serialize(product)), meta: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) }, stats: { total: await prisma.product.count({ where: { isDeleted: false } }), active, outOfStock, inactive } };
}

// Filter options are built from the browsing context (category + search) and the Admin
// Category↔Attribute configuration, never from the already-filtered result page. That is what
// keeps the option lists stable when the user narrows down to a single brand or value.
export async function getFilterMetadata(context) {
  const scope = await whereForQuery(context, null);

  const [brandGroups, valueGroups, priceAggregate, categoryGroups] = await Promise.all([
    prisma.product.groupBy({ by: ['brandId'], where: { ...scope, brandId: { not: null } }, _count: { _all: true } }),
    prisma.productAttributeValue.groupBy({ by: ['attributeValueId'], where: { attributeValueId: { not: null }, product: scope }, _count: { _all: true } }),
    prisma.product.aggregate({ where: scope, _min: { price: true }, _max: { price: true } }),
    prisma.product.groupBy({ by: ['categoryId'], where: { ...scope, categoryId: { not: null } }, _count: { _all: true } }),
  ]);

  const brandCounts = new Map(brandGroups.map(row => [row.brandId, row._count._all]));
  const brands = brandCounts.size
    ? (await prisma.brand.findMany({
        where: { id: { in: [...brandCounts.keys()] }, isActive: true },
        select: { id: true, name: true, slug: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })).map(brand => ({ ...brand, productCount: brandCounts.get(brand.id) || 0 }))
    : [];

  const valueCounts = new Map(valueGroups.map(row => [row.attributeValueId, row._count._all]));
  const category = context.category
    ? await prisma.category.findFirst({ where: { slug: context.category, isActive: true }, select: { id: true, name: true } })
    : null;

  // Category drives which attributes may appear; without one, fall back to the attributes that
  // in-scope products actually use.
  const sourceAttributes = category
    ? (await prisma.categoryAttribute.findMany({
        where: { categoryId: category.id, attribute: { isActive: true } },
        orderBy: [{ sortOrder: 'asc' }, { attributeId: 'asc' }],
        include: { attribute: { include: { values: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } } },
      })).map(link => link.attribute)
    : valueCounts.size
      ? await prisma.attribute.findMany({
          where: { isActive: true, values: { some: { id: { in: [...valueCounts.keys()] } } } },
          include: { values: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
      : [];

  const attributes = sourceAttributes
    .filter(attribute => ['SELECT', 'MULTI_SELECT'].includes(attribute.type))
    .map(attribute => ({
      id: attribute.id, name: attribute.name, slug: attribute.slug, type: attribute.type,
      values: attribute.values
        .filter(value => valueCounts.has(value.id))
        .map(value => ({ id: value.id, value: value.value, productCount: valueCounts.get(value.id) })),
    }))
    .filter(attribute => attribute.values.length > 0);

  const categoryCounts = new Map(categoryGroups.map(row => [row.categoryId, row._count._all]));
  const categories = categoryCounts.size
    ? (await prisma.category.findMany({
        where: { id: { in: [...categoryCounts.keys()] }, isActive: true },
        select: { id: true, name: true, slug: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })).map(cat => ({ ...cat, productCount: categoryCounts.get(cat.id) || 0 }))
    : [];

  const section = context.sectionSlug
    ? await prisma.productSection.findFirst({ where: { slug: context.sectionSlug }, select: { id: true, name: true } })
    : null;

  return {
    brands,
    attributes,
    priceRange: { min: priceAggregate._min.price ?? null, max: priceAggregate._max.price ?? null },
    categoryName: category?.name ?? null,
    sectionName: section?.name ?? null,
    categories,
  };
}

export async function getProduct(id) { return serialize(await getByIdOrThrow(id, true), true); }
export async function getProductBySlug(slug) {
  const product = await prisma.product.findFirst({ where: { slug, isDeleted: false, isActive: true }, include: detailInclude });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);
  const promotions = await getActivePromotionsForProduct(product.id, product.categoryId);
  return { ...serialize(product, true, true), ...await getProductStatistics(product.id), promotions };
}
export async function listCategories() {
  const rows = await prisma.product.findMany({ where: { isDeleted: false, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  return rows.map(row => row.category).filter(Boolean);
}

export async function createProduct(payload, images) {
  try {
    const category = await resolveProductCategory(payload);
    const brand = await resolveProductBrand(payload);
    if (!category.categoryId) throw productError('Cần chọn danh mục để sinh Mã SP.', 400);
    return await prisma.$transaction(async tx => {
      const sku = await generateProductSkuForCategoryId(tx, category.categoryId);
      const product = await tx.product.create({ data: { name: payload.name, slug: payload.slug, sku, ...category, ...brand, shortDescription: payload.shortDescription, description: payload.description, price: payload.price, originalPrice: payload.originalPrice, costPrice: payload.costPrice, stockQuantity: payload.stockQuantity, lowStockThreshold: payload.lowStockThreshold, isActive: payload.isActive }, include: detailInclude });
      if (payload.customSpecifications.length) await tx.productSpecification.createMany({ data: payload.customSpecifications.map(spec => ({ ...spec, productId: product.id })) });
      await replaceProductAttributes(tx, product.id, category.categoryId, payload.productAttributes || []);
      if (payload.highlightSpecs.length) await tx.productHighlightSpec.createMany({ data: payload.highlightSpecs.map(spec => ({ ...spec, productId: product.id })) });
      if (images.length) await tx.productImage.createMany({ data: images.map((image, index) => ({ imageUrl: image.imageUrl, productId: product.id, sortOrder: index, isPrimary: index === 0 })) });
      return serialize(await tx.product.findUnique({ where: { id: product.id }, include: detailInclude }), true);
    });
  } catch (error) { mapUniqueError(error); }
}

export async function updateProduct(id, payload, images) {
  const current = await getByIdOrThrow(id, true);
  const category = await resolveProductCategory(payload);
  const brand = await resolveProductBrand(payload);
  let removedImages = [];
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.product.update({ where: { id }, data: { name: payload.name, slug: payload.slug, ...category, ...brand, shortDescription: payload.shortDescription, description: payload.description, price: payload.price, originalPrice: payload.originalPrice, costPrice: payload.costPrice, stockQuantity: payload.stockQuantity, lowStockThreshold: payload.lowStockThreshold, isActive: payload.isActive } });
      await tx.productSpecification.deleteMany({ where: { productId: id } });
      if (payload.customSpecifications.length) await tx.productSpecification.createMany({ data: payload.customSpecifications.map(spec => ({ ...spec, productId: id })) });
      await replaceProductAttributes(tx, id, category.categoryId, payload.productAttributes || []);
      await tx.productHighlightSpec.deleteMany({ where: { productId: id } });
      if (payload.highlightSpecs.length) await tx.productHighlightSpec.createMany({ data: payload.highlightSpecs.map(spec => ({ ...spec, productId: id })) });
      const keep = new Set(payload.keepImageIds ?? current.images.map(image => image.id));
      removedImages = current.images.filter(image => !keep.has(image.id));
      if (removedImages.length) await tx.productImage.deleteMany({ where: { id: { in: removedImages.map(image => image.id) } } });
      if (images.length) await tx.productImage.createMany({ data: images.map((image, index) => ({ imageUrl: image.imageUrl, productId: id, sortOrder: current.images.length + index, isPrimary: current.images.length === 0 && index === 0 })) });
      const remaining = await tx.productImage.findMany({ where: { productId: id }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] });
      const remainingIds = new Set(remaining.map(image => image.id));
      const orderIds = [...new Set([...(payload.imageOrderIds ?? []), ...remaining.map(image => image.id)])].filter(imageId => remainingIds.has(imageId));
      await tx.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } });
      for (const [sortOrder, imageId] of orderIds.entries()) await tx.productImage.update({ where: { id: imageId }, data: { sortOrder, isPrimary: sortOrder === 0 } });
      return serialize(await tx.product.findUnique({ where: { id }, include: detailInclude }), true);
    });
    await Promise.all(removedImages.map(image => removeProductImage(image.imageUrl.split('/').pop())));
    return result;
  } catch (error) { mapUniqueError(error); }
}

export async function updateProductDescription(id, description) {
  await getByIdOrThrow(id, false);
  return serialize(await prisma.product.update({ where: { id }, data: { description }, include: detailInclude }), true);
}

export async function setStatus(id, isActive) {
  await getByIdOrThrow(id, false);
  return serialize(await prisma.product.update({ where: { id }, data: { isActive }, include: detailInclude }), true);
}

export async function softDeleteProduct(id) {
  const current = await getByIdOrThrow(id, false);
  await prisma.product.update({ where: { id }, data: { isActive: false, isDeleted: true, deletedAt: new Date() } });
  return { id: current.id, deleted: true };
}

export async function removeImage(id, imageId) {
  const image = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
  if (!image) throw productError('Không tìm thấy ảnh sản phẩm.', 404);
  await prisma.productImage.delete({ where: { id: imageId } });
  if (image.isPrimary) {
    await prisma.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } });
    const replacement = await prisma.productImage.findFirst({ where: { productId: id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    if (replacement) await prisma.productImage.update({ where: { id: replacement.id }, data: { isPrimary: true } });
  }
  await removeProductImage(image.imageUrl.split('/').pop());
  return getProduct(id);
}
