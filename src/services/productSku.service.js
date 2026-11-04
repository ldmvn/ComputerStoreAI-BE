const FALLBACK_PREFIX_OVERRIDES = {
  'pc-gaming': 'PCGM',
  'laptop': 'LAP',
  'cpu': 'CPU',
  'vga': 'VGA',
  'ram': 'RAM',
};

function sanitizePrefix(value) {
  const upper = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return upper.slice(0, 8) || 'SP';
}

export function resolveCategoryPrefix(category) {
  if (!category) return null;
  if (category.skuPrefix && category.skuPrefix.trim()) return sanitizePrefix(category.skuPrefix);
  const fromSlug = FALLBACK_PREFIX_OVERRIDES[category.slug];
  if (fromSlug) return fromSlug;
  return sanitizePrefix(category.name);
}

function formatSku(prefix, sequence) {
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

export async function generateProductSku(tx, categoryId, category) {
  if (!categoryId) throw new Error('CATEGORY_REQUIRED');
  const prefix = resolveCategoryPrefix(category);
  if (!prefix) throw new Error('CATEGORY_PREFIX_MISSING');
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const latest = await tx.product.findFirst({
    where: { sku: { startsWith: prefix } },
    orderBy: { id: 'desc' },
    select: { sku: true },
  });
  let nextSequence = 1;
  if (latest?.sku) {
    const match = latest.sku.match(pattern);
    if (match) nextSequence = Number(match[1]) + 1;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = formatSku(prefix, nextSequence);
    const exists = await tx.product.findUnique({ where: { sku: candidate }, select: { id: true } });
    if (!exists) return candidate;
    nextSequence += 1;
  }
  return formatSku(prefix, nextSequence);
}

export async function generateProductSkuForCategoryId(tx, categoryId) {
  if (!categoryId) throw new Error('CATEGORY_REQUIRED');
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, slug: true, skuPrefix: true } });
  if (!category) throw new Error('CATEGORY_NOT_FOUND');
  return generateProductSku(tx, categoryId, category);
}
