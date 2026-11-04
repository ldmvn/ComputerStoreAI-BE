import { prisma } from '../config/prisma.js';
import { categoryError } from '../validators/category.validator.js';

function mapUniqueError(error) {
  if (error.code !== 'P2002') throw error;
  throw categoryError('Đường dẫn danh mục đã tồn tại.', 409);
}

function productWhere(category) {
  return { isDeleted: false, OR: [{ categoryId: category.id }, { categoryId: null, category: category.name }] };
}

export async function listAdminCategories(filters) {
  const where = {};
  if (filters.search) where.OR = [{ name: { contains: filters.search } }, { slug: { contains: filters.search } }];
  if (filters.status === 'active') where.isActive = true;
  if (filters.status === 'inactive') where.isActive = false;
  if (filters.type === 'root') where.parentId = null;
  if (filters.type === 'child') where.parentId = { not: null };
  const orderBy = filters.sort === 'name'
    ? [{ name: 'asc' }, { id: 'asc' }]
    : filters.sort === 'updated'
      ? [{ updatedAt: 'desc' }, { id: 'asc' }]
      : [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }];
  const categories = await prisma.category.findMany({ where, orderBy, include: { parent: { select: { id: true, name: true } } } });
  return Promise.all(categories.map(async category => ({
    ...category,
    productCount: await prisma.product.count({ where: productWhere(category) }),
  })));
}

export async function getAdminCategory(id) {
  const category = await prisma.category.findUnique({ where: { id }, include: { parent: { select: { id: true, name: true } } } });
  if (!category) throw categoryError('Không tìm thấy danh mục.', 404);
  return { ...category, productCount: await prisma.product.count({ where: productWhere(category) }) };
}

async function validateParent(parentId, currentId) {
  if (parentId === null) return;
  if (parentId === currentId) throw categoryError('Danh mục không thể làm danh mục cha của chính nó.');
  let parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true, parentId: true } });
  if (!parent) throw categoryError('Danh mục cha không tồn tại.', 404);
  while (parent) {
    if (parent.id === currentId) throw categoryError('Không thể tạo vòng lặp trong cây danh mục.');
    parent = parent.parentId === null ? null : await prisma.category.findUnique({ where: { id: parent.parentId }, select: { id: true, parentId: true } });
  }
}

export async function createCategory(data) {
  await validateParent(data.parentId, null);
  try { return await prisma.category.create({ data }); } catch (error) { mapUniqueError(error); }
}

export async function updateCategory(id, data) {
  if (!await prisma.category.findUnique({ where: { id }, select: { id: true } })) throw categoryError('Không tìm thấy danh mục.', 404);
  await validateParent(data.parentId, id);
  try { return await prisma.category.update({ where: { id }, data }); } catch (error) { mapUniqueError(error); }
}

export async function setCategoryStatus(id, isActive) {
  try { return await prisma.category.update({ where: { id }, data: { isActive } }); }
  catch (error) { if (error.code === 'P2025') throw categoryError('Không tìm thấy danh mục.', 404); throw error; }
}

export async function setCategoryOrder(id, sortOrder) {
  try { return await prisma.category.update({ where: { id }, data: { sortOrder } }); }
  catch (error) { if (error.code === 'P2025') throw categoryError('Không tìm thấy danh mục.', 404); throw error; }
}

export async function deleteCategory(id) {
  try {
    await prisma.$transaction(async tx => {
      const category = await tx.category.findUnique({ where: { id }, select: { id: true, name: true, _count: { select: { children: true } } } });
      if (!category) throw categoryError('Không tìm thấy danh mục.', 404);
      if (category._count.children) throw categoryError(`Danh mục này đang có ${category._count.children} danh mục con. Vui lòng chuyển danh mục con trước khi xóa.`, 409);
      const productCount = await tx.product.count({ where: productWhere(category) });
      if (productCount) throw categoryError(`Danh mục này đang có ${productCount} sản phẩm. Vui lòng chuyển sản phẩm sang danh mục khác hoặc ẩn danh mục.`, 409);
      await tx.product.updateMany({ where: { categoryId: id, isDeleted: true }, data: { categoryId: null } });
      await tx.category.delete({ where: { id } });
    });
  } catch (error) {
    if (error.code === 'P2025') throw categoryError('Không tìm thấy danh mục.', 404);
    if (error.code === 'P2003') throw categoryError('Không thể xóa danh mục đang được tham chiếu. Vui lòng tải lại và thử lại.', 409);
    throw error;
  }
  return { id };
}

export async function listPublicCategoryMenu() {
  const categories = await prisma.category.findMany({
    where: { isActive: true, parentId: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true, name: true, slug: true, icon: true,
      children: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, slug: true, icon: true } },
    },
  });
  return categories;
}