import { prisma } from '../config/prisma.js';

const ALLOWED_RATINGS = new Set([1, 2, 3, 4, 5]);

export async function listAllReviews({ page = 1, limit = 20, search, rating, status, from, to } = {}) {
  const where = {};

  if (rating && ALLOWED_RATINGS.has(parseInt(rating))) {
    where.rating = parseInt(rating);
  }
  if (status === 'published') where.isPublished = true;
  else if (status === 'hidden') where.isPublished = false;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  if (search) {
    where.OR = [
      { product: { name: { contains: search } } },
      { author: { fullName: { contains: search } } },
      { author: { email: { contains: search } } },
      { content: { contains: search } },
    ];
  }

  const [reviews, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, slug: true, images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 } } },
        author: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.productReview.count({ where }),
  ]);

  const items = reviews.map(r => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    images: (() => { try { return r.images ? JSON.parse(r.images) : []; } catch { return []; } })(),
    isPublished: r.isPublished,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    product: { id: r.product.id, name: r.product.name, slug: r.product.slug, imageUrl: r.product.images[0]?.imageUrl ?? null },
    author: r.author ? { id: r.author.id, fullName: r.author.fullName, email: r.author.email } : null,
  }));

  return { reviews: items, total, page, limit };
}

export async function getReviewStats() {
  const [total, published, hidden, byRating] = await Promise.all([
    prisma.productReview.count(),
    prisma.productReview.count({ where: { isPublished: true } }),
    prisma.productReview.count({ where: { isPublished: false } }),
    prisma.productReview.groupBy({ by: ['rating'], _count: true }),
  ]);
  const ratingMap = Object.fromEntries(byRating.map(r => [r.rating, r._count]));
  return { total, published, hidden, ratingMap };
}

export async function setPublished(reviewId, isPublished) {
  const review = await prisma.productReview.findUnique({ where: { id: reviewId } });
  if (!review) { const e = new Error('Đánh giá không tồn tại.'); e.statusCode = 404; throw e; }
  return prisma.productReview.update({ where: { id: reviewId }, data: { isPublished } });
}

export async function deleteReview(reviewId) {
  const review = await prisma.productReview.findUnique({ where: { id: reviewId } });
  if (!review) { const e = new Error('Đánh giá không tồn tại.'); e.statusCode = 404; throw e; }
  await prisma.productReview.delete({ where: { id: reviewId } });
}
