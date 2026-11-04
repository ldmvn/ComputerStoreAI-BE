import { prisma } from '../config/prisma.js';
import { menuError, safeMenuUrl } from '../validators/megaMenu.validator.js';

const orderBy = [{ sortOrder: 'asc' }, { id: 'asc' }];
const include = { groups: { orderBy, include: { items: { orderBy, include: { category: true, brand: true, attribute: true, attributeOption: true } } } }, brands: { orderBy: [{ sortOrder: 'asc' }, { brandId: 'asc' }], include: { brand: true } } };
const productUrl = params => `/customer/products?${new URLSearchParams(params)}`;

export async function attributeOptions(db = prisma) {
  return db.attribute.findMany({ where: { isActive: true, type: { in: ['SELECT', 'MULTI_SELECT'] } }, select: { id: true, name: true, slug: true, type: true, values: { where: { isActive: true }, orderBy, select: { id: true, value: true } } }, orderBy });
}
function hasValidReference(item, activeCategoryIds) {
  if (item.type === 'CATEGORY') return Boolean(item.category?.isActive && activeCategoryIds.has(item.categoryId));
  if (item.type === 'BRAND') return Boolean(item.brand?.isActive);
  if (item.type === 'ATTRIBUTE_FILTER') return Boolean(item.attributeId && item.attributeValueId && item.attribute?.isActive && item.attributeOption?.isActive && item.attributeOption.attributeId === item.attributeId);
  if (item.type === 'CUSTOM_URL') return safeMenuUrl(item.customUrl);
  return item.type === 'PRICE_FILTER';
}

export function itemHref(item, rootSlug, activeCategoryIds, attributeCounts) {
  const params = { category: rootSlug };
  if (item.type === 'CATEGORY') return item.category?.isActive && activeCategoryIds.has(item.categoryId) ? productUrl({ category: item.category.slug }) : null;
  if (item.type === 'BRAND') return item.brand?.isActive ? productUrl({ ...params, brand: item.brand.slug }) : null;
  if (item.type === 'PRICE_FILTER') {
    if (item.minPrice !== null) params.minPrice = String(item.minPrice);
    if (item.maxPrice !== null) params.maxPrice = String(item.maxPrice);
    return productUrl(params);
  }
  if (item.type === 'ATTRIBUTE_FILTER') return hasValidReference(item, activeCategoryIds) ? productUrl({ ...params, attribute: item.attribute.slug, attributeValue: String(item.attributeValueId) }) : null;
  return item.type === 'CUSTOM_URL' && safeMenuUrl(item.customUrl) ? item.customUrl : null;
}
async function visibility(db) {
  const [categories, specs] = await Promise.all([
    db.category.findMany({ select: { id: true, parentId: true, isActive: true } }),
    db.productAttributeValue.groupBy({ by: ['attributeId', 'attributeValueId'], where: { product: { isDeleted: false, isActive: true }, attributeValueId: { not: null } }, _count: { _all: true } }),
  ]);
  const byId = new Map(categories.map(c => [c.id, c]));
  const valid = new Set();
  for (const category of categories) {
    let current = category; const seen = new Set();
    while (current?.isActive && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === null) { valid.add(category.id); break; }
      current = byId.get(current.parentId);
    }
  }
  return { valid, attributeCounts: new Map(specs.map(row => [JSON.stringify([row.attributeId, row.attributeValueId]), row._count._all])) };
}
export async function getAdminMenu(categoryId) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.parentId !== null) throw menuError('Chọn danh mục cấp chính còn tồn tại.', 404);
  const [menu, state] = await Promise.all([prisma.megaMenu.findUnique({ where: { categoryId }, include }), visibility(prisma)]);
  if (!menu) return { category, menu: null };
  return { category, menu: { ...menu, groups: menu.groups.map(g => ({ ...g, items: g.items.map(item => ({ ...item, productCount: item.type === 'ATTRIBUTE_FILTER' ? (state.attributeCounts.get(JSON.stringify([item.attributeId, item.attributeValueId])) || 0) : undefined, invalid: !hasValidReference(item, state.valid) })) })) } };
}
export async function saveMenu(categoryId, isActive, brandIds) {
  return prisma.$transaction(async tx => {
    const category = await tx.category.findUnique({ where: { id: categoryId } });
    if (!category || category.parentId !== null) throw menuError('Chọn danh mục cấp chính còn tồn tại.');
    const data = { isActive };
    if (brandIds !== undefined) {
      if (await tx.brand.count({ where: { id: { in: brandIds } } }) !== brandIds.length) throw menuError('Thương hiệu nổi bật không tồn tại.');
      data.brands = { deleteMany: {}, create: brandIds.map((brandId, sortOrder) => ({ brandId, sortOrder })) };
    }
    return tx.megaMenu.upsert({ where: { categoryId }, create: { categoryId, isActive, ...(brandIds === undefined ? {} : { brands: { create: brandIds.map((brandId, sortOrder) => ({ brandId, sortOrder })) } }) }, update: data, include });
  });
}
export async function createGroup(categoryId, data) {
  const { menu } = await getAdminMenu(categoryId);
  if (!menu) throw menuError('Lưu cấu hình Mega Menu trước khi thêm nhóm.');
  return prisma.megaMenuGroup.create({ data: { ...data, megaMenuId: menu.id } });
}
export const updateGroup = (id, data) => prisma.megaMenuGroup.update({ where: { id }, data });
export const deleteGroup = id => prisma.megaMenuGroup.delete({ where: { id } });
export async function saveItem(groupId, id, data) {
  try {
    return await prisma.$transaction(async tx => {
      if (!await tx.megaMenuGroup.findUnique({ where: { id: groupId } })) throw menuError('Nhóm không tồn tại.', 404);
      if (id && !await tx.megaMenuItem.findFirst({ where: { id, groupId } })) throw menuError('Mục không tồn tại.', 404);
      if (data.categoryId && !await tx.category.findUnique({ where: { id: data.categoryId } })) throw menuError('Danh mục không tồn tại.');
      if (data.brandId && !await tx.brand.findUnique({ where: { id: data.brandId } })) throw menuError('Thương hiệu không tồn tại.');
      if (data.type === 'ATTRIBUTE_FILTER') {
        const value = await tx.attributeValue.findFirst({ where: { id: data.attributeValueId, attributeId: data.attributeId, isActive: true, attribute: { isActive: true } }, include: { attribute: true } });
        if (!value) throw menuError('Cặp thuộc tính/giá trị không tồn tại hoặc đang bị tắt.');
        data.attributeName = value.attribute.name;
        data.attributeValue = value.value;
      }
      const target = { type: data.type };
      for (const field of ['categoryId', 'brandId', 'attributeId', 'attributeValueId', 'attributeName', 'attributeValue', 'minPrice', 'maxPrice', 'customUrl']) target[field] = data[field];
      if (await tx.megaMenuItem.findFirst({ where: { groupId, ...target, ...(id ? { id: { not: id } } : {}) } })) throw menuError('Liên kết này đã có trong nhóm.', 409);
      return id ? tx.megaMenuItem.update({ where: { id }, data }) : tx.megaMenuItem.create({ data: { ...data, groupId } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) { if (error.code === 'P2003') throw menuError('Dữ liệu tham chiếu đã bị xóa. Vui lòng tải lại.'); throw error; }
}
export const deleteItem = id => prisma.megaMenuItem.delete({ where: { id } });
export async function publicMenus(slug) {
  const [categories, state] = await Promise.all([
    prisma.category.findMany({ where: { parentId: null, isActive: true, ...(slug ? { slug } : {}) }, orderBy, include: { children: { where: { isActive: true }, orderBy, select: { id: true, name: true, slug: true, icon: true } }, megaMenu: { include } } }),
    visibility(prisma),
  ]);
  return categories.map(category => {
    const menu = category.megaMenu?.isActive ? category.megaMenu : null;
    return { category: { id: category.id, name: category.name, slug: category.slug, icon: category.icon, href: productUrl({ category: category.slug }), children: category.children }, groups: (menu?.groups || []).filter(g => g.isActive).map(g => ({ id: g.id, title: g.title, columnSpan: g.columnSpan, items: g.items.filter(i => i.isActive).map(i => ({ id: i.id, label: i.label, type: i.type, href: itemHref(i, category.slug, state.valid, state.attributeCounts) })).filter(i => i.href) })).filter(g => g.items.length), brands: (menu?.brands || []).filter(b => b.brand.isActive).map(({ brand }) => ({ id: brand.id, name: brand.name, slug: brand.slug, logoUrl: brand.logoUrl, href: productUrl({ category: category.slug, brand: brand.slug }) })) };
  });
}
