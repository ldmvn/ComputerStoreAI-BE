import { prisma } from '../config/prisma.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

/** Strip Vietnamese diacritics + đ→d for accent-insensitive token matching. */
function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

const BASE_URL = '/customer/products';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/search/suggestions?q=
//
// Returns up to 6 structured { label, url } suggestions using hierarchical
// intent detection:
//
//   Single-token ("laptop"):
//     Category → Category+Brand combos from real product data
//
//   Multi-token ("laptop lenovo", "laptop lenovo thinkpad"):
//     Token parsing: longest category prefix → brand → series/model remainder
//     Each level is validated against real products before being suggested.
//     Level 3 ("Laptop Lenovo ThinkPad") uses ?search= for the series term
//     because no structured Series attribute exists in the DB — admin can add
//     one ("Product Series") to enable proper attribute-based filtering.
//
//   Text fallback (fills remaining slots):
//     SearchLog user queries → AttributeValue model numbers/specs
//
// Requires q.length >= 2.
// ─────────────────────────────────────────────────────────────────────────────
export const suggestions = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ suggestions: [] });

  const like         = `%${q}%`;
  const prefixLike   = `${q}%`;
  const qStripped    = stripDiacritics(q);
  const likeStripped = `%${qStripped}%`;

  const results = [];
  const seen    = new Set();
  const add = (label, url) => {
    if (results.length >= 6) return false;
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    results.push({ label: label.trim(), url });
    return true;
  };

  const tokens      = q.trim().split(/\s+/);
  const isMultiToken = tokens.length >= 2;

  if (isMultiToken) {
    // ── MULTI-TOKEN PATH ────────────────────────────────────────────────────
    // Load all cats + brands (small tables) + text fallback in one parallel batch.
    const [allCats, allBrands, fromLogs, fromAttrs] = await Promise.all([
      prisma.$queryRaw`SELECT id, name, slug FROM Category WHERE isActive = 1`,
      prisma.$queryRaw`SELECT id, name, slug FROM Brand WHERE isActive = 1`,
      prisma.$queryRaw`
        SELECT query AS term,
          CASE WHEN query LIKE ${prefixLike} THEN 3 ELSE 1 END AS relevance
        FROM SearchLog
        WHERE query LIKE ${like} OR query LIKE ${likeStripped}
        ORDER BY relevance DESC, count DESC LIMIT 6
      `,
      prisma.$queryRaw`
        SELECT DISTINCT av.value AS term,
          CASE WHEN av.value LIKE ${prefixLike} THEN 3 ELSE 1 END AS relevance
        FROM AttributeValue av
        JOIN Attribute a ON a.id = av.attributeId
        WHERE (av.value LIKE ${like} OR av.value LIKE ${likeStripped})
          AND av.isActive = 1 AND a.isActive = 1
          AND a.type = 'TEXT' AND CHAR_LENGTH(av.value) <= 60
        ORDER BY relevance DESC, av.value ASC LIMIT 6
      `,
    ]);

    // Normalise for case+accent-insensitive token matching
    const normCats = allCats.map(c => ({
      id:   Number(c.id),
      name: String(c.name),
      slug: String(c.slug),
      norm: stripDiacritics(String(c.name).toLowerCase()),
    }));
    const normBrands = allBrands.map(b => ({
      id:   Number(b.id),
      name: String(b.name),
      slug: String(b.slug),
      norm: stripDiacritics(String(b.name).toLowerCase()),
    }));

    // Find longest token-prefix that exactly matches a category (1–3 tokens).
    // Longest-match-first so "Laptop Gaming" beats "Laptop" for query "laptop gaming asus".
    let matchedCat = null, catTokenCount = 0;
    for (let n = Math.min(tokens.length, 3); n >= 1; n--) {
      const prefix     = tokens.slice(0, n).join(' ');
      const prefixNorm = stripDiacritics(prefix.toLowerCase());
      const cat = normCats.find(c => c.norm === prefixNorm || c.slug.toLowerCase() === prefix.toLowerCase());
      if (cat) { matchedCat = cat; catTokenCount = n; break; }
    }

    // Find first token after the category that exactly matches a brand.
    let matchedBrand = null, brandTokenOffset = -1;
    const afterCat = tokens.slice(catTokenCount);
    for (let i = 0; i < afterCat.length; i++) {
      const tNorm = stripDiacritics(afterCat[i].toLowerCase());
      const brand = normBrands.find(b => b.norm === tNorm || b.slug.toLowerCase() === afterCat[i].toLowerCase());
      if (brand) { matchedBrand = brand; brandTokenOffset = i; break; }
    }

    // If no category was detected, scan all tokens for a brand anywhere.
    if (!matchedCat && !matchedBrand) {
      for (const token of tokens) {
        const tNorm = stripDiacritics(token.toLowerCase());
        const brand = normBrands.find(b => b.norm === tNorm);
        if (brand) { matchedBrand = brand; break; }
      }
    }

    if (matchedCat && matchedBrand) {
      // Tokens not claimed by cat or brand → series/model keyword
      const usedIndices = new Set();
      for (let i = 0; i < catTokenCount; i++) usedIndices.add(i);
      if (brandTokenOffset >= 0) usedIndices.add(catTokenCount + brandTokenOffset);
      const seriesTokens = tokens.filter((_, i) => !usedIndices.has(i));

      // Run count checks in parallel (avoids sequential waterfall)
      const seriesSearch = seriesTokens.join(' ');
      const [seriesCountRows, catBrandCountRows] = await Promise.all([
        seriesTokens.length > 0
          ? prisma.$queryRaw`
              SELECT COUNT(*) AS cnt FROM Product
              WHERE categoryId = ${matchedCat.id} AND brandId = ${matchedBrand.id}
                AND isActive = 1 AND isDeleted = 0
                AND name LIKE ${`%${seriesSearch}%`}
            `
          : Promise.resolve([{ cnt: 0 }]),
        prisma.$queryRaw`
          SELECT COUNT(*) AS cnt FROM Product
          WHERE categoryId = ${matchedCat.id} AND brandId = ${matchedBrand.id}
            AND isActive = 1 AND isDeleted = 0
        `,
      ]);

      // Level 3: Category + Brand + Series/Model keyword
      if (seriesTokens.length > 0 && Number(seriesCountRows[0]?.cnt ?? 0) > 0) {
        const seriesLabel = seriesTokens.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
        add(
          `${matchedCat.name} ${matchedBrand.name} ${seriesLabel}`,
          `${BASE_URL}?category=${encodeURIComponent(matchedCat.slug)}&brand=${encodeURIComponent(matchedBrand.slug)}&search=${encodeURIComponent(seriesSearch)}`,
        );
      }

      // Level 2: Category + Brand
      if (Number(catBrandCountRows[0]?.cnt ?? 0) > 0) {
        add(
          `${matchedCat.name} ${matchedBrand.name}`,
          `${BASE_URL}?category=${encodeURIComponent(matchedCat.slug)}&brand=${encodeURIComponent(matchedBrand.slug)}`,
        );
      }

      // Level 1: Category alone
      add(matchedCat.name, `${BASE_URL}?category=${encodeURIComponent(matchedCat.slug)}`);

    } else if (matchedCat) {
      // Category identified but no brand in query → show category + top brands
      add(matchedCat.name, `${BASE_URL}?category=${encodeURIComponent(matchedCat.slug)}`);
      const catBrands = await prisma.$queryRaw`
        SELECT b.name AS brandName, b.slug AS brandSlug, COUNT(p.id) AS cnt
        FROM Product p
        JOIN Brand b ON b.id = p.brandId AND b.isActive = 1
        WHERE p.categoryId = ${matchedCat.id} AND p.isActive = 1 AND p.isDeleted = 0
        GROUP BY b.id, b.name, b.slug
        ORDER BY cnt DESC LIMIT 5
      `;
      for (const row of catBrands) {
        add(
          `${matchedCat.name} ${String(row.brandName)}`,
          `${BASE_URL}?category=${encodeURIComponent(matchedCat.slug)}&brand=${encodeURIComponent(String(row.brandSlug))}`,
        );
      }

    } else if (matchedBrand) {
      // Brand identified but no category → show brand across its top categories
      const brandCats = await prisma.$queryRaw`
        SELECT c.name AS catName, c.slug AS catSlug, COUNT(p.id) AS cnt
        FROM Product p
        JOIN Category c ON c.id = p.categoryId AND c.isActive = 1
        WHERE p.brandId = ${matchedBrand.id} AND p.isActive = 1 AND p.isDeleted = 0
        GROUP BY c.id, c.name, c.slug
        ORDER BY cnt DESC LIMIT 4
      `;
      for (const row of brandCats) {
        add(
          `${String(row.catName)} ${matchedBrand.name}`,
          `${BASE_URL}?category=${encodeURIComponent(String(row.catSlug))}&brand=${encodeURIComponent(matchedBrand.slug)}`,
        );
      }
    }

    // Fill remaining slots with text fallback
    const textItems = [
      ...fromLogs.map(r  => ({ term: String(r.term), score: Number(r.relevance), src: 0 })),
      ...fromAttrs.map(r => ({ term: String(r.term), score: Number(r.relevance), src: 1 })),
    ].sort((a, b) => b.score - a.score || a.src - b.src);
    for (const { term } of textItems) add(term, `${BASE_URL}?search=${encodeURIComponent(term)}`);

  } else {
    // ── SINGLE-TOKEN PATH ────────────────────────────────────────────────────
    // Run all four lookups in one parallel batch.
    const [catBrandRows, brandCatRows, fromLogs, fromAttrs] = await Promise.all([

      // Categories matching q + brands that actually have products in each category
      prisma.$queryRaw`
        SELECT
          c.id        AS catId,
          c.name      AS catName,
          c.slug      AS catSlug,
          b.name      AS brandName,
          b.slug      AS brandSlug,
          COUNT(p.id) AS productCount
        FROM Category c
        JOIN Product p ON p.categoryId = c.id AND p.isActive = 1 AND p.isDeleted = 0
        JOIN Brand   b ON b.id = p.brandId   AND b.isActive = 1
        WHERE (c.name LIKE ${like} OR c.name LIKE ${likeStripped}) AND c.isActive = 1
        GROUP BY c.id, c.name, c.slug, b.id, b.name, b.slug
        ORDER BY
          CASE WHEN LOWER(c.name) = LOWER(${q}) THEN 0
               WHEN c.name LIKE ${prefixLike}    THEN 1
               ELSE 2
          END ASC,
          c.sortOrder ASC,
          productCount DESC
        LIMIT 24
      `,

      // Brands matching q + categories those brands have products in
      prisma.$queryRaw`
        SELECT
          b.name      AS brandName,
          b.slug      AS brandSlug,
          c.name      AS catName,
          c.slug      AS catSlug,
          COUNT(p.id) AS productCount
        FROM Brand   b
        JOIN Product p ON p.brandId   = b.id AND p.isActive = 1 AND p.isDeleted = 0
        JOIN Category c ON c.id = p.categoryId AND c.isActive = 1
        WHERE (b.name LIKE ${like} OR b.name LIKE ${likeStripped}) AND b.isActive = 1
        GROUP BY b.id, b.name, b.slug, c.id, c.name, c.slug
        ORDER BY
          CASE WHEN LOWER(b.name) = LOWER(${q}) THEN 0
               WHEN b.name LIKE ${prefixLike}    THEN 1
               ELSE 2
          END ASC,
          productCount DESC
        LIMIT 12
      `,

      // SearchLog — actual user search queries ranked by popularity
      prisma.$queryRaw`
        SELECT query AS term,
          CASE WHEN query LIKE ${prefixLike} THEN 3 ELSE 1 END AS relevance
        FROM SearchLog
        WHERE query LIKE ${like} OR query LIKE ${likeStripped}
        ORDER BY relevance DESC, count DESC LIMIT 6
      `,

      // AttributeValue — model numbers / spec strings ≤ 60 chars
      prisma.$queryRaw`
        SELECT DISTINCT av.value AS term,
          CASE WHEN av.value LIKE ${prefixLike} THEN 3 ELSE 1 END AS relevance
        FROM AttributeValue av
        JOIN Attribute a ON a.id = av.attributeId
        WHERE (av.value LIKE ${like} OR av.value LIKE ${likeStripped})
          AND av.isActive = 1 AND a.isActive = 1
          AND a.type = 'TEXT' AND CHAR_LENGTH(av.value) <= 60
        ORDER BY relevance DESC, av.value ASC LIMIT 6
      `,
    ]);

    // Group catBrandRows by category; emit category then its top brands
    const byCategory = new Map();
    for (const row of catBrandRows) {
      const catId = String(row.catId);
      if (!byCategory.has(catId)) {
        byCategory.set(catId, { catName: String(row.catName), catSlug: String(row.catSlug), brands: [] });
      }
      byCategory.get(catId).brands.push({ brandName: String(row.brandName), brandSlug: String(row.brandSlug) });
    }

    for (const { catName, catSlug, brands } of byCategory.values()) {
      if (results.length >= 5) break;
      add(catName, `${BASE_URL}?category=${encodeURIComponent(catSlug)}`);
      for (const { brandName, brandSlug } of brands.slice(0, 4)) {
        if (results.length >= 5) break;
        add(
          `${catName} ${brandName}`,
          `${BASE_URL}?category=${encodeURIComponent(catSlug)}&brand=${encodeURIComponent(brandSlug)}`,
        );
      }
    }

    // Brand-only path — only when no categories matched
    if (byCategory.size === 0) {
      const byBrand = new Map();
      for (const row of brandCatRows) {
        const bSlug = String(row.brandSlug);
        if (!byBrand.has(bSlug)) {
          byBrand.set(bSlug, { brandName: String(row.brandName), brandSlug: bSlug, cats: [] });
        }
        byBrand.get(bSlug).cats.push({ catName: String(row.catName), catSlug: String(row.catSlug) });
      }
      for (const [, { brandName, brandSlug, cats }] of byBrand) {
        if (results.length >= 5) break;
        for (const { catName, catSlug } of cats.slice(0, 3)) {
          if (results.length >= 5) break;
          add(
            `${catName} ${brandName}`,
            `${BASE_URL}?category=${encodeURIComponent(catSlug)}&brand=${encodeURIComponent(brandSlug)}`,
          );
        }
      }
    }

    // Text fallback
    const textItems = [
      ...fromLogs.map(r  => ({ term: String(r.term), score: Number(r.relevance), src: 0 })),
      ...fromAttrs.map(r => ({ term: String(r.term), score: Number(r.relevance), src: 1 })),
    ].sort((a, b) => b.score - a.score || a.src - b.src);
    for (const { term } of textItems) add(term, `${BASE_URL}?search=${encodeURIComponent(term)}`);
  }

  res.json({ suggestions: results });
});

// GET /api/search/products?q=
// Requires q.length >= 2. Ranked: exact name > prefix > word-boundary > substring.
export const searchProducts = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ products: [] });

  const like         = `%${q}%`;
  const prefixLike   = `${q}%`;
  const wordLike     = `% ${q}%`;
  const qStripped    = stripDiacritics(q);
  const likeStripped = `%${qStripped}%`;

  const rows = await prisma.$queryRaw`
    SELECT
      p.id, p.name, p.slug, p.price, p.originalPrice,
      (SELECT imageUrl FROM ProductImage
       WHERE productId = p.id AND isPrimary = 1 LIMIT 1) AS primaryImage,
      CASE
        WHEN LOWER(p.name) = LOWER(${q}) THEN 4
        WHEN p.name LIKE ${prefixLike}    THEN 3
        WHEN p.name LIKE ${wordLike}      THEN 2
        ELSE 1
      END AS relevance
    FROM Product p
    WHERE p.isDeleted = 0 AND p.isActive = 1
      AND (p.name LIKE ${like} OR p.name LIKE ${likeStripped} OR p.sku LIKE ${like})
    ORDER BY relevance DESC, p.price ASC
    LIMIT 5
  `;

  res.json({
    products: rows.map(p => ({
      id:            Number(p.id),
      name:          p.name,
      slug:          p.slug,
      price:         Number(p.price),
      originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
      primaryImage:  p.primaryImage ?? null,
    })),
  });
});

// GET /api/search/trending
export const trending = asyncHandler(async (_req, res) => {
  const logs = await prisma.$queryRaw`
    SELECT query, count FROM SearchLog
    ORDER BY count DESC LIMIT 12
  `;
  res.json({ trending: logs.map(l => ({ query: l.query, count: Number(l.count) })) });
});

// POST /api/search/record  { query }
export const record = asyncHandler(async (req, res) => {
  const query = String(req.body?.query || '').trim().toLowerCase().slice(0, 100);
  if (query.length < 2) return res.json({ ok: true });
  await prisma.$executeRaw`
    INSERT INTO SearchLog (query, count, updatedAt)
    VALUES (${query}, 1, NOW())
    ON DUPLICATE KEY UPDATE count = count + 1, updatedAt = NOW()
  `;
  res.json({ ok: true });
});
