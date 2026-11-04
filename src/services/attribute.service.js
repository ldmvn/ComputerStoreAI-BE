import { prisma } from '../config/prisma.js';
import { attributeError } from '../validators/attribute.validator.js';

const valueOrder = [{ sortOrder: 'asc' }, { id: 'asc' }];

const attributeInclude = {
  values: { orderBy: valueOrder },
  categories: {
    orderBy: { sortOrder: 'asc' },
    include: { category: { select: { id: true, name: true, slug: true } } },
  },
  groups: {
    orderBy: { sortOrder: 'asc' },
    include: { group: { select: { id: true, name: true, slug: true } } },
  },
  _count: { select: { productValues: true, menuItems: true } },
};

const attributeOrderBy = [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }];

function mapAttribute(attribute) {
  return {
    ...attribute,
    categories: attribute.categories?.map(link => ({
      ...link.category,
      sortOrder: link.sortOrder,
      isRequired: link.isRequired,
      showInForm: link.showInForm,
      showInDetail: link.showInDetail,
      usedInFilter: link.usedInFilter,
      requiredForBuildPC: link.requiredForBuildPC,
    })) || [],
    groups: attribute.groups?.map(link => ({
      ...link.group,
      sortOrder: link.sortOrder,
    })) || [],
  };
}

function uniqueError(error) {
  if (error.code === 'P2002') throw attributeError('Slug thuộc tính hoặc giá trị này đã tồn tại.', 409);
  throw error;
}

// ── Attribute CRUD ────────────────────────────────────────────────────────────

export async function listAttributes({ activeOnly = false } = {}) {
  return (await prisma.attribute.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: attributeInclude,
    orderBy: attributeOrderBy,
  })).map(mapAttribute);
}

export async function categoryAttributes(categoryId, { activeOnly = true } = {}) {
  const links = await prisma.categoryAttribute.findMany({
    where: { categoryId, ...(activeOnly ? { attribute: { isActive: true } } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { attributeId: 'asc' }],
    include: { attribute: { include: { values: { where: activeOnly ? { isActive: true } : {}, orderBy: valueOrder } } } },
  });
  return links.map(link => ({
    ...link.attribute,
    categorySortOrder: link.sortOrder,
    isRequired: link.isRequired,
    showInForm: link.showInForm,
    showInDetail: link.showInDetail,
    usedInFilter: link.usedInFilter,
    requiredForBuildPC: link.requiredForBuildPC,
  }));
}

export async function categoryAttributesBySlug(slug) {
  const category = await prisma.category.findFirst({ where: { slug, isActive: true }, select: { id: true } });
  if (!category) throw attributeError('Danh mục không tồn tại.', 404);
  return categoryAttributes(category.id);
}

export async function createAttribute(data) {
  try { return mapAttribute(await prisma.attribute.create({ data, include: attributeInclude })); }
  catch (error) { uniqueError(error); }
}

export async function updateAttribute(id, data) {
  try {
    return mapAttribute(await prisma.attribute.update({ where: { id }, data, include: attributeInclude }));
  } catch (error) {
    if (error.code === 'P2025') throw attributeError('Thuộc tính không tồn tại.', 404);
    uniqueError(error);
  }
}

export async function setAttributeStatus(id, isActive) { return updateAttribute(id, { isActive }); }
export async function setAttributeOrder(id, sortOrder) { return updateAttribute(id, { sortOrder }); }

export async function deleteAttribute(id) {
  const attribute = await prisma.attribute.findUnique({
    where: { id },
    include: { _count: { select: { productValues: true } } },
  });
  if (!attribute) throw attributeError('Thuộc tính không tồn tại.', 404);
  if (attribute._count.productValues) {
    throw attributeError(
      `Không thể xóa "${attribute.name}" vì đang được ${attribute._count.productValues} dữ liệu sản phẩm sử dụng. Hãy tắt thuộc tính thay vì xóa.`,
      409,
    );
  }
  await prisma.$transaction(async tx => {
    await tx.attributeGroupMember.deleteMany({ where: { attributeId: id } });
    await tx.categoryAttribute.deleteMany({ where: { attributeId: id } });
    await tx.attributeValue.deleteMany({ where: { attributeId: id } });
    await tx.attribute.delete({ where: { id } });
  });
}

// Save category links (simple — categoryIds only, flags stay at defaults).
// Kept for backward-compatibility with existing AttributeManager UI.
export async function saveCategories(id, categoryIds) {
  const attribute = await prisma.attribute.findUnique({ where: { id }, select: { sortOrder: true } });
  if (!attribute) throw attributeError('Thuộc tính không tồn tại.', 404);
  const found = await prisma.category.count({ where: { id: { in: categoryIds } } });
  if (found !== categoryIds.length) throw attributeError('Một hoặc nhiều danh mục không tồn tại.');
  await prisma.$transaction(async tx => {
    await tx.categoryAttribute.deleteMany({ where: { attributeId: id } });
    if (categoryIds.length) {
      await tx.categoryAttribute.createMany({
        data: categoryIds.map(categoryId => ({ categoryId, attributeId: id, sortOrder: attribute.sortOrder })),
      });
    }
  });
  return mapAttribute(await prisma.attribute.findUnique({ where: { id }, include: attributeInclude }));
}

// Save category links (rich — full per-category flag configuration).
// Used by Phase 3+ UI where admin can configure each flag per category.
export async function saveCategoryLinks(id, links) {
  const attribute = await prisma.attribute.findUnique({ where: { id }, select: { id: true, usedInBuildPC: true } });
  if (!attribute) throw attributeError('Thuộc tính không tồn tại.', 404);

  const categoryIds = links.map(l => l.categoryId);
  if (categoryIds.length) {
    const found = await prisma.category.count({ where: { id: { in: categoryIds } } });
    if (found !== categoryIds.length) throw attributeError('Một hoặc nhiều danh mục không tồn tại.');
  }

  // Guard: requiredForBuildPC only valid when usedInBuildPC is true on the attribute
  for (const link of links) {
    if (link.requiredForBuildPC && !attribute.usedInBuildPC) {
      throw attributeError(
        'Không thể đặt "Bắt buộc cho Build PC" khi thuộc tính chưa được bật "Dùng cho Build PC".',
        400,
      );
    }
  }

  await prisma.$transaction(async tx => {
    await tx.categoryAttribute.deleteMany({ where: { attributeId: id } });
    if (links.length) {
      await tx.categoryAttribute.createMany({
        data: links.map(l => ({ ...l, attributeId: id })),
      });
    }
  });
  return mapAttribute(await prisma.attribute.findUnique({ where: { id }, include: attributeInclude }));
}

// ── AttributeValue CRUD ───────────────────────────────────────────────────────

export async function createValue(attributeId, data) {
  const attribute = await prisma.attribute.findUnique({ where: { id: attributeId } });
  if (!attribute) throw attributeError('Thuộc tính không tồn tại.', 404);
  if (!['SELECT', 'MULTI_SELECT'].includes(attribute.type)) {
    throw attributeError('Chỉ thuộc tính SELECT/MULTI_SELECT mới có danh sách giá trị.');
  }
  try { return await prisma.attributeValue.create({ data: { ...data, attributeId } }); }
  catch (error) { uniqueError(error); }
}

export async function updateValue(id, data) {
  try { return await prisma.attributeValue.update({ where: { id }, data }); }
  catch (error) {
    if (error.code === 'P2025') throw attributeError('Giá trị thuộc tính không tồn tại.', 404);
    uniqueError(error);
  }
}

export async function deleteValue(id) {
  const value = await prisma.attributeValue.findUnique({
    where: { id },
    include: { _count: { select: { productValues: true } } },
  });
  if (!value) throw attributeError('Giá trị thuộc tính không tồn tại.', 404);
  if (value._count.productValues) {
    throw attributeError(
      `Không thể xóa "${value.value}" vì đang được ${value._count.productValues} sản phẩm sử dụng. Hãy tắt giá trị thay vì xóa.`,
      409,
    );
  }
  await prisma.attributeValue.delete({ where: { id } });
}

// ── AttributeGroup CRUD ───────────────────────────────────────────────────────

const groupInclude = {
  members: {
    orderBy: { sortOrder: 'asc' },
    include: { attribute: { select: { id: true, name: true, slug: true, type: true, isActive: true } } },
  },
  _count: { select: { members: true } },
};

const groupOrderBy = [{ sortOrder: 'asc' }, { name: 'asc' }];

function mapGroup(group) {
  return {
    ...group,
    members: group.members?.map(m => ({ ...m.attribute, sortOrder: m.sortOrder })) || [],
  };
}

function groupUniqueError(error) {
  if (error.code === 'P2002') throw attributeError('Slug nhóm thuộc tính này đã tồn tại.', 409);
  throw error;
}

export async function listGroups() {
  return (await prisma.attributeGroup.findMany({ include: groupInclude, orderBy: groupOrderBy })).map(mapGroup);
}

export async function createGroup(data) {
  try { return mapGroup(await prisma.attributeGroup.create({ data, include: groupInclude })); }
  catch (error) { groupUniqueError(error); }
}

export async function updateGroup(id, data) {
  try {
    return mapGroup(await prisma.attributeGroup.update({ where: { id }, data, include: groupInclude }));
  } catch (error) {
    if (error.code === 'P2025') throw attributeError('Nhóm thuộc tính không tồn tại.', 404);
    groupUniqueError(error);
  }
}

export async function setGroupStatus(id, isActive) { return updateGroup(id, { isActive }); }
export async function setGroupOrder(id, sortOrder) { return updateGroup(id, { sortOrder }); }

export async function deleteGroup(id) {
  const group = await prisma.attributeGroup.findUnique({ where: { id } });
  if (!group) throw attributeError('Nhóm thuộc tính không tồn tại.', 404);
  // Members are cascade-deleted via FK. No product data is affected.
  await prisma.attributeGroup.delete({ where: { id } });
}

// Set members of a group (replace all at once)
export async function saveGroupMembers(groupId, members) {
  const group = await prisma.attributeGroup.findUnique({ where: { id: groupId } });
  if (!group) throw attributeError('Nhóm thuộc tính không tồn tại.', 404);
  const attributeIds = members.map(m => m.attributeId);
  if (attributeIds.length) {
    const found = await prisma.attribute.count({ where: { id: { in: attributeIds } } });
    if (found !== attributeIds.length) throw attributeError('Một hoặc nhiều thuộc tính không tồn tại.');
  }
  await prisma.$transaction(async tx => {
    await tx.attributeGroupMember.deleteMany({ where: { groupId } });
    if (members.length) {
      await tx.attributeGroupMember.createMany({
        data: members.map(m => ({ groupId, attributeId: m.attributeId, sortOrder: m.sortOrder })),
      });
    }
  });
  return mapGroup(await prisma.attributeGroup.findUnique({ where: { id: groupId }, include: groupInclude }));
}
