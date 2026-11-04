// Document Loading stage of the RAG pipeline. Turns raw sources (today:
// Policy Pages already stored via the existing Content Pages feature;
// future: product descriptions, spec sheets, user manuals) into the plain
// `RagDocument` shape chunking/embedding/indexing consume.
//
// This stage never calls an LLM or embedding API — it only reads from MySQL
// and strips markup. The policy-page loader below is real and already works
// end to end against the Prisma model the Dashboard's Content Pages editor
// writes to (see backend/src/controllers/contentPage.controller.js).

import { prisma } from '../../../config/prisma.js';

/**
 * @typedef {Object} RagDocument
 * @property {string} id            - stable id, e.g. "policy:warranty"
 * @property {string} sourceType    - 'policy_page' | 'product_description' | 'product_spec' | 'faq' | 'manual'
 * @property {string} sourceRef     - natural key for the source row, e.g. a pageKey or product slug
 * @property {string} [title]
 * @property {string} content       - plain text, HTML already stripped
 * @property {number|null} productId
 * @property {string} updatedAt     - ISO timestamp, used to detect stale index entries
 */

// Minimal, dependency-free HTML→text: strips tags, decodes the handful of
// entities sanitize-html actually emits for this content, collapses whitespace.
// Good enough for chunking/embedding; not a general-purpose HTML renderer.
function htmlToPlainText(html) {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Loads every published Policy Page (warranty, return, shipping, FAQ page, …)
 * as RagDocuments. This is the one real, working document source wired up in
 * this phase — everything else (product descriptions, manuals) is prepared
 * as a contract (see ingestProductDescriptions below) but not ingested yet.
 * @returns {Promise<RagDocument[]>}
 */
export async function loadPolicyPageDocuments() {
  const pages = await prisma.policyPage.findMany();
  return pages
    .filter(page => page.contentHtml?.trim())
    .map(page => ({
      id: `policy:${page.pageKey}`,
      sourceType: 'policy_page',
      sourceRef: page.pageKey,
      title: page.title,
      content: htmlToPlainText(page.contentHtml),
      productId: null,
      updatedAt: page.updatedAt.toISOString(),
    }));
}

/**
 * Loads active products as RagDocuments. Each product becomes one document
 * combining: name, brand, category, HTML description (→ plain text),
 * specifications, and highlight specs into a single coherent text block.
 * Price/stock are deliberately excluded — those come from live Prisma queries.
 * @param {{ productIds?: number[] }} [options] - optionally limit to specific products (for incremental sync)
 * @returns {Promise<RagDocument[]>}
 */
export async function loadProductDocuments({ productIds } = {}) {
  const where = { isActive: true, isDeleted: false };
  if (productIds?.length) where.id = { in: productIds };

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true, name: true, slug: true, sku: true,
      description: true,
      categoryId: true,
      brandId: true,
      updatedAt: true,
      specifications: { select: { name: true, value: true }, orderBy: { sortOrder: 'asc' } },
      highlightSpecs: { select: { content: true }, orderBy: { sortOrder: 'asc' } },
    },
  });

  const categoryIds = [...new Set(products.map(p => p.categoryId).filter(Boolean))];
  const brandIds = [...new Set(products.map(p => p.brandId).filter(Boolean))];

  const [categories, brands] = await Promise.all([
    categoryIds.length ? prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : [],
    brandIds.length ? prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } }) : [],
  ]);

  const catMap = new Map(categories.map(c => [c.id, c.name]));
  const brandMap = new Map(brands.map(b => [b.id, b.name]));

  return products.map(product => {
    const category = catMap.get(product.categoryId) || '';
    const brand = brandMap.get(product.brandId) || '';
    const descText = htmlToPlainText(product.description);

    const parts = [`Sản phẩm: ${product.name}`];
    if (brand) parts.push(`Thương hiệu: ${brand}`);
    if (category) parts.push(`Danh mục: ${category}`);
    if (product.sku) parts.push(`SKU: ${product.sku}`);

    if (product.highlightSpecs.length > 0) {
      parts.push('Thông số nổi bật:');
      product.highlightSpecs.forEach(hs => parts.push(`- ${hs.content}`));
    }

    if (product.specifications.length > 0) {
      parts.push('Thông số kỹ thuật:');
      product.specifications.forEach(s => parts.push(`- ${s.name}: ${s.value}`));
    }

    if (descText) {
      parts.push('Mô tả chi tiết:');
      parts.push(descText);
    }

    return {
      id: `product:${product.id}`,
      sourceType: 'product',
      sourceRef: product.slug || String(product.id),
      title: product.name,
      content: parts.join('\n'),
      productId: product.id,
      updatedAt: product.updatedAt.toISOString(),
      metadata: { category, brand, sku: product.sku },
    };
  });
}
