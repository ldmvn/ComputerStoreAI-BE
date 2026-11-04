import { prisma } from '../config/prisma.js';
import { Prisma } from '@prisma/client';
import { productError } from '../validators/product.validator.js';
import { reviewError } from '../validators/productReview.validator.js';
import { removeReviewImage } from './reviewMedia.service.js';

async function getDistribution(productId) {
  const rows = await prisma.productReview.groupBy({
    by: ['rating'],
    where: { productId, isPublished: true, rating: { gte: 1, lte: 5 } },
    _count: { _all: true },
  });
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) distribution[row.rating] = row._count._all;
  return distribution;
}

export async function getProductStatistics(productId) {
  const distribution = await getDistribution(productId);
  const [reviews, commentCount, viewCount] = await prisma.$transaction([
    prisma.productReview.aggregate({
      where: { productId, isPublished: true, rating: { gte: 1, lte: 5 } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.productComment.count({ where: { productId, isPublished: true } }),
    prisma.productView.count({ where: { productId } }),
  ]);
  return { ratingAverage: reviews._avg.rating, reviewCount: reviews._count._all, commentCount, viewCount, distribution };
}

// Each page visit has a UUID. Retrying the same event never creates a second view.
export async function recordProductView(slug, viewId) {
  if (typeof viewId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(viewId)) {
    throw productError('Mã lượt xem không hợp lệ.', 400);
  }
  const productId = await prisma.$transaction(async tx => {
    const product = await tx.product.findFirst({ where: { slug, isActive: true, isDeleted: false }, select: { id: true } });
    if (!product) throw productError('Không tìm thấy sản phẩm.', 404);
    await tx.productView.createMany({ data: [{ productId: product.id, viewId: viewId.toLowerCase() }], skipDuplicates: true });
    return product.id;
  });
  // Read after commit: a duplicate concurrent request must see the committed event.
  return { viewCount: await prisma.productView.count({ where: { productId } }) };
}

function parseImages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim());
  if (typeof value === 'string') {
    try { const data = JSON.parse(value); return Array.isArray(data) ? data.filter(item => typeof item === 'string' && item.trim()) : []; }
    catch { return []; }
  }
  return [];
}

function mapReviewRow(row) {
  return {
    id: row.id,
    productId: row.productId,
    rating: row.rating,
    content: row.content,
    images: parseImages(row.images),
    verifiedPurchase: Boolean(row.verifiedPurchase),
    createdAt: row.createdAt,
    author: row.authorId ? { id: row.authorId, fullName: row.authorFullName, avatarUrl: row.authorAvatarUrl } : null,
  };
}

export async function listProductReviews(slug, { rating, page, limit }) {
  const product = await prisma.product.findFirst({ where: { slug, isActive: true, isDeleted: false }, select: { id: true } });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);
  const skip = (page - 1) * limit;
  const ratingFilter = rating ? Prisma.sql`AND r.rating = ${rating}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT r.id, r.productId, r.rating, r.content, r.images, r.verifiedPurchase, r.createdAt, r.userId,
           u.id AS authorId, u.fullName AS authorFullName, u.avatarUrl AS authorAvatarUrl
    FROM ProductReview r
    LEFT JOIN User u ON u.id = r.userId
    WHERE r.productId = ${product.id} AND r.isPublished = 1 ${ratingFilter}
    ORDER BY r.createdAt DESC, r.id DESC
    LIMIT ${limit} OFFSET ${skip}
  `;
  const totalRow = await prisma.$queryRaw`
    SELECT COUNT(*) AS total FROM ProductReview r WHERE r.productId = ${product.id} AND r.isPublished = 1 ${ratingFilter}
  `;
  const total = Number(totalRow[0]?.total || 0);
  const stats = await prisma.$queryRaw`
    SELECT AVG(rating) AS avgRating FROM ProductReview WHERE productId = ${product.id} AND isPublished = 1 AND rating BETWEEN 1 AND 5
  `;
  const distribution = await getDistribution(product.id);
  return {
    items: rows.map(mapReviewRow),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    summary: { ratingAverage: stats[0]?.avgRating ? Number(stats[0].avgRating) : null, distribution },
  };
}

// Returns the current user's review eligibility for a product.
// userId is optional (null for guests).
export async function getReviewEligibility(slug, userId) {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, isDeleted: false },
    select: { id: true },
  });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);

  if (!userId) {
    return { canReview: false, hasPurchased: false, hasCompletedOrder: false, hasReviewed: false, reviewId: null };
  }

  const [purchaseRow, existingReview] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        MAX(CASE WHEN o.status = 'DELIVERED' THEN 1 ELSE 0 END) AS hasCompleted,
        COUNT(oi.id) AS purchaseCount
      FROM OrderItem oi
      INNER JOIN \`Order\` o ON o.id = oi.orderId
      WHERE oi.productId = ${product.id}
        AND o.userId = ${userId}
        AND o.status NOT IN ('CANCELLED')
    `,
    prisma.productReview.findFirst({
      where: { productId: product.id, userId },
      select: { id: true },
    }),
  ]);

  const hasPurchased = Number(purchaseRow[0]?.purchaseCount ?? 0) > 0;
  const hasCompletedOrder = Number(purchaseRow[0]?.hasCompleted ?? 0) === 1;
  const hasReviewed = Boolean(existingReview);
  const canReview = hasPurchased && hasCompletedOrder && !hasReviewed;

  return {
    canReview,
    hasPurchased,
    hasCompletedOrder,
    hasReviewed,
    reviewId: existingReview?.id ?? null,
  };
}

// Returns the authenticated user's own review for this product (or null).
export async function getMyReviewForProduct(slug, userId) {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, isDeleted: false },
    select: { id: true },
  });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);

  const rows = await prisma.$queryRaw`
    SELECT r.id, r.productId, r.rating, r.content, r.images, r.verifiedPurchase, r.createdAt, r.userId,
           u.id AS authorId, u.fullName AS authorFullName, u.avatarUrl AS authorAvatarUrl
    FROM ProductReview r
    LEFT JOIN User u ON u.id = r.userId
    WHERE r.productId = ${product.id} AND r.userId = ${userId}
    LIMIT 1
  `;
  return rows[0] ? mapReviewRow(rows[0]) : null;
}

export async function createProductReview(slug, userId, payload, images) {
  const product = await prisma.product.findFirst({ where: { slug, isActive: true, isDeleted: false }, select: { id: true } });
  if (!product) throw productError('Không tìm thấy sản phẩm.', 404);
  if (images.length > 3) throw reviewError('Mỗi đánh giá chỉ được đính kèm tối đa 3 ảnh.');

  // Verify purchase: must have a DELIVERED order containing this product
  const deliveredOrder = await prisma.$queryRaw`
    SELECT 1 FROM OrderItem oi
    INNER JOIN \`Order\` o ON o.id = oi.orderId
    WHERE oi.productId = ${product.id}
      AND o.userId = ${userId}
      AND o.status = 'DELIVERED'
    LIMIT 1
  `;
  if (!deliveredOrder[0]) {
    const err = reviewError('Bạn chỉ có thể đánh giá sản phẩm sau khi đã mua và nhận hàng thành công.', 403);
    throw err;
  }

  // Check for existing review (pre-check before the unique constraint catches it)
  const existing = await prisma.productReview.findFirst({
    where: { productId: product.id, userId },
    select: { id: true },
  });
  if (existing) {
    throw reviewError('Bạn đã đánh giá sản phẩm này rồi. Hãy chỉnh sửa đánh giá hiện tại.', 409);
  }

  const imagesJson = images.length ? JSON.stringify(images) : null;
  try {
    await prisma.$executeRaw`
      INSERT INTO ProductReview (productId, userId, rating, content, images, isPublished, verifiedPurchase, createdAt, updatedAt)
      VALUES (${product.id}, ${userId}, ${payload.rating}, ${payload.content}, ${imagesJson}, 1, 1, NOW(), NOW())
    `;
  } catch (err) {
    if (err?.code === 'P2002' || (err?.message && err.message.includes('Duplicate entry'))) {
      throw reviewError('Bạn đã đánh giá sản phẩm này rồi. Hãy chỉnh sửa đánh giá hiện tại.', 409);
    }
    throw err;
  }

  const rows = await prisma.$queryRaw`
    SELECT r.id, r.productId, r.rating, r.content, r.images, r.verifiedPurchase, r.createdAt, r.userId,
           u.id AS authorId, u.fullName AS authorFullName, u.avatarUrl AS authorAvatarUrl
    FROM ProductReview r
    LEFT JOIN User u ON u.id = r.userId
    WHERE r.productId = ${product.id} AND r.userId = ${userId}
    ORDER BY r.id DESC
    LIMIT 1
  `;
  const review = rows[0];
  if (!review) throw productError('Không thể tạo đánh giá.', 500);
  return mapReviewRow(review);
}

export async function updateProductReview(slug, rawReviewId, userId, payload) {
  const reviewId = Number(rawReviewId);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) throw reviewError('Đánh giá không hợp lệ.');

  const rows = await prisma.$queryRaw`
    SELECT r.id FROM ProductReview r
    INNER JOIN Product p ON p.id = r.productId
    WHERE r.id = ${reviewId} AND r.userId = ${userId} AND p.slug = ${slug}
    LIMIT 1
  `;
  if (!rows[0]) throw reviewError('Không tìm thấy đánh giá hoặc bạn không có quyền sửa.', 404);

  await prisma.$executeRaw`
    UPDATE ProductReview
    SET rating = ${payload.rating}, content = ${payload.content}, isPublished = 0, updatedAt = NOW()
    WHERE id = ${reviewId}
  `;

  const updated = await prisma.$queryRaw`
    SELECT r.id, r.productId, r.rating, r.content, r.images, r.verifiedPurchase, r.createdAt, r.userId,
           u.id AS authorId, u.fullName AS authorFullName, u.avatarUrl AS authorAvatarUrl
    FROM ProductReview r
    LEFT JOIN User u ON u.id = r.userId
    WHERE r.id = ${reviewId}
    LIMIT 1
  `;
  return mapReviewRow(updated[0]);
}

export async function deleteProductReview(slug, rawReviewId, userId) {
  const reviewId = Number(rawReviewId);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) throw reviewError('Đánh giá không hợp lệ.');

  const deletedImages = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw`
      SELECT r.id, r.images
      FROM ProductReview r
      INNER JOIN Product p ON p.id = r.productId
      WHERE r.id = ${reviewId} AND r.userId = ${userId} AND p.slug = ${slug}
      LIMIT 1
    `;
    if (!rows[0]) throw reviewError('Không tìm thấy đánh giá hoặc bạn không có quyền xóa.', 404);
    await tx.productReview.delete({ where: { id: reviewId } });
    return parseImages(rows[0].images);
  });

  if (!deletedImages.length) return;
  const remaining = await prisma.productReview.findMany({ where: { images: { not: null } }, select: { images: true } });
  const referenced = new Set(remaining.flatMap(row => parseImages(row.images)));
  await Promise.all(deletedImages.filter(url => !referenced.has(url)).map(removeReviewImage));
}
