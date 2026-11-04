import { prisma } from '../config/prisma.js';
import { brandError, slugifyBrand } from '../validators/brand.validator.js';
import { createHash } from 'node:crypto';

const publicBrandSelect = { id: true, name: true, slug: true };
export async function resolveBrandFilter({ brand, brandId }, db = prisma) {
  if (brandId) return db.brand.findUnique({ where: { id: brandId }, select: publicBrandSelect });
  if (!brand) return null;
  const record = await db.brand.findUnique({ where: { slug: brand }, select: publicBrandSelect });
  if (record) return record;
  // Old imports used a hash of the name. Keep those bookmarks working after normalization.
  if (/^legacy-[a-f0-9]{32}$/i.test(brand)) {
    const records = await db.brand.findMany({ select: publicBrandSelect });
    return records.find(row => `legacy-${createHash('md5').update(row.name.trim().toLowerCase()).digest('hex')}` === brand.toLowerCase()) || null;
  }
  return null;
}

export async function normalizeLegacyBrandSlugs(apply = false) {
  return prisma.$transaction(async tx => {
    const brands = await tx.brand.findMany({ select: publicBrandSelect, orderBy: { id: 'asc' } });
    const reserved = new Set(brands.map(brand => brand.slug.toLowerCase()));
    const changes = brands.filter(brand => brand.slug.startsWith('legacy-')).map(brand => {
      const slug = slugifyBrand(brand.name);
      if (!slug || slug.length > 191) throw brandError(`Không tạo được slug hợp lệ cho thương hiệu “${brand.name}”.`);
      if (reserved.has(slug)) throw brandError(`Slug “${slug}” đã tồn tại; không tự động gộp thương hiệu.`, 409);
      reserved.add(slug);
      return { id: brand.id, name: brand.name, before: brand.slug, after: slug };
    });
    if (apply) for (const change of changes) await tx.brand.update({ where: { id: change.id }, data: { slug: change.after } });
    return changes;
  }, { isolationLevel: 'Serializable' });
}

function mapUniqueError(error) {
  if (error.code !== 'P2002') throw error;
  throw brandError('Đường dẫn thương hiệu đã tồn tại.', 409);
}

function withProductCount(brand) {
  const { _count, ...data } = brand;
  return { ...data, productCount: _count.products };
}

export async function listAdminBrands(filters = {}) {
  const where = {};
  if (filters.search) where.OR = [{ name: { contains: filters.search } }, { slug: { contains: filters.search } }];
  if (filters.status === 'active') where.isActive = true;
  if (filters.status === 'inactive') where.isActive = false;
  const brands = await prisma.brand.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return brands.map(withProductCount);
}

export async function getAdminBrand(id) {
  const brand = await prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!brand) throw brandError('Không tìm thấy thương hiệu.', 404);
  return withProductCount(brand);
}

export async function createBrand(data) {
  try { return await prisma.brand.create({ data }); } catch (error) { mapUniqueError(error); }
}

export async function updateBrand(id, data) {
  try { return await prisma.brand.update({ where: { id }, data }); }
  catch (error) {
    if (error.code === 'P2025') throw brandError('Không tìm thấy thương hiệu.', 404);
    mapUniqueError(error);
  }
}

export async function setBrandStatus(id, isActive) {
  try { return await prisma.brand.update({ where: { id }, data: { isActive } }); }
  catch (error) { if (error.code === 'P2025') throw brandError('Không tìm thấy thương hiệu.', 404); throw error; }
}

export async function deleteBrand(id) {
  try {
    return await prisma.$transaction(async tx => {
      const brand = await tx.brand.findUnique({ where: { id }, select: { id: true, logoUrl: true } });
      if (!brand) throw brandError('Không tìm thấy thương hiệu.', 404);
      const productCount = await tx.product.count({ where: { brandId: id } });
      if (productCount) throw brandError(`Thương hiệu đang được ${productCount} sản phẩm sử dụng. Hãy chuyển sản phẩm sang thương hiệu khác trước khi xóa.`, 409);
      await tx.brand.delete({ where: { id } });
      return brand;
    });
  } catch (error) {
    if (error.code === 'P2003') throw brandError('Không thể xóa thương hiệu đang được sản phẩm sử dụng.', 409);
    throw error;
  }
}
