import { prisma } from '../config/prisma.js';
import { wishlistError } from '../validators/wishlist.validator.js';

const detailInclude = {
  product: {
    include: {
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: 1 },
      highlightSpecs: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      brandRecord: true,
    },
  },
};

export async function getOrCreateWishlist(userId, tx = prisma) {
  const existing = await tx.wishlist.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.wishlist.create({ data: { userId } });
}

export async function listWishlist(userId) {
  await getOrCreateWishlist(userId);
  const items = await prisma.wishlistItem.findMany({ where: { wishlistId: userId }, include: detailInclude, orderBy: { createdAt: 'desc' } });
  return items.filter(item => item.product && !item.product.isDeleted).map(item => ({
    productId: item.productId,
    addedAt: item.createdAt,
    product: {
      id: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      sku: item.product.sku,
      price: item.product.price,
      originalPrice: item.product.originalPrice,
      stockQuantity: item.product.stockQuantity,
      isActive: item.product.isActive,
      stockStatus: item.product.stockQuantity === 0 ? 'OUT_OF_STOCK' : item.product.stockQuantity <= item.product.lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK',
      primaryImage: item.product.images?.[0]?.imageUrl || null,
      brand: item.product.brandRecord ? { id: item.product.brandRecord.id, name: item.product.brandRecord.name, slug: item.product.brandRecord.slug } : null,
      highlightSpecs: item.product.highlightSpecs.map(spec => ({ id: spec.id, content: spec.content, sortOrder: spec.sortOrder })),
    },
  }));
}

export async function isFavorited(userId, productId) {
  const item = await prisma.wishlistItem.findUnique({ where: { wishlistId_productId: { wishlistId: userId, productId } } });
  return Boolean(item);
}

export async function addWishlistItem(userId, productId) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, isDeleted: true, isActive: true } });
  if (!product || product.isDeleted) throw wishlistError('Sản phẩm không tồn tại hoặc đã bị ẩn.', 404);
  await getOrCreateWishlist(userId);
  const item = await prisma.wishlistItem.upsert({
    where: { wishlistId_productId: { wishlistId: userId, productId } },
    create: { wishlistId: userId, productId },
    update: {},
    include: detailInclude,
  });
  await prisma.wishlist.update({ where: { userId }, data: { updatedAt: new Date() } });
  return { productId, product: item.product, addedAt: item.createdAt };
}

export async function removeWishlistItem(userId, productId) {
  const existing = await prisma.wishlistItem.findUnique({ where: { wishlistId_productId: { wishlistId: userId, productId } } });
  if (!existing) return false;
  await prisma.wishlistItem.delete({ where: { wishlistId_productId: { wishlistId: userId, productId } } });
  await prisma.wishlist.update({ where: { userId }, data: { updatedAt: new Date() } });
  return true;
}