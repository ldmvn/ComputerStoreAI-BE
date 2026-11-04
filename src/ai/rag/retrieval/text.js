// Shared Vietnamese normalization; keep model/SKU boundaries independently of prose.
export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}
export const compact = text => normalize(text).replace(/[^a-z0-9]/g, '');
const STOP = new Set('la gi cua va cho toi minh ban co khong nay do ay thi voi ve mot nhung cac duoc hay nhe a san pham thong so'.split(' '));
export function tokenize(text) {
  const words = normalize(text).match(/[a-z0-9]+/g) || [];
  const tokens = words.filter(w => w.length > 1 && !STOP.has(w));
  // Preserve hyphenated SKUs and meaningful model suffixes as additional terms.
  for (const id of identifiers(text)) tokens.push(`id:${id}`);
  for (const match of normalize(text).matchAll(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g)) tokens.push(compact(match[0]));
  return tokens;
}
export function identifiers(text) {
  const s = normalize(text);
  const found = [...s.matchAll(/\b(?:rtx|gtx|rx)\s*[- ]?\d{3,5}(?:\s*(?:ti|super|xtx|xt))?(?:\s*super)?\b|\bi[3579]\s*[- ]?\d{4,5}[a-z]{0,2}\b|\bryzen\s*[3579]\s*[- ]?\d{4,5}(?:x3d|[a-z]{0,2})\b|\b(?:b|x|z|h|a)\d{3}[a-z]?\b|\bddr[345]\b/g)].map(m => compact(m[0]));
  for (const m of s.matchAll(/\b(?:samsung\s*)?(\d{3,4})\s*(pro|evo(?:\s*plus)?|qvo)\b/g)) found.push(`samsung${m[1]}${compact(m[2])}`);
  for (const m of s.matchAll(/\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+\b/g)) {
    // CPU model already captured above; avoid partial identifiers.
    const id = compact(m[0]);
    if (!found.some(f => f.includes(id))) found.push(id);
  }
  for (const m of s.matchAll(/\b[a-z][a-z0-9]{3,}\b/g)) {
    const id = m[0];
    if ((id.match(/\d/g) || []).length < 2 || /^(?:ddr|gddr|lga|am\d|pcie)/.test(id)) continue;
    if (!found.some(f => f.includes(id))) found.push(id);
  }
  return [...new Set(found)];
}
export function matchesFilter(metadata, filter) {
  return !filter || Object.entries(filter).every(([key, value]) =>
    Array.isArray(value) ? value.includes(metadata?.[key]) : metadata?.[key] === value);
}
export function capacityOf(text) {
  const match = normalize(text).match(/\b(\d+(?:[.,]\d+)?)\s*(tb|gb)\b/);
  return match ? Number(match[1].replace(',', '.')) * (match[2] === 'tb' ? 1000 : 1) : null;
}
export function queryIdentity(query) {
  const allIds = identifiers(query);
  const strong = allIds.filter(id => !/^ddr[345]$/.test(id));
  const ids = strong.length ? strong : allIds;
  const constraints = String(query).split(/\s+(?:với|và|so với|vs\.?|versus)\s+/iu)
    .map(part => ({ ids: identifiers(part), capacity: capacityOf(part) }));
  return { ids, compact: compact(query), text: normalize(query), constraints };
}
export function documentIdentity(doc) {
  const sku = doc.metadata?.sku || doc.content?.match(/\bSKU:\s*([^\n]+)/i)?.[1];
  const title = doc.metadata?.title || doc.content?.split('\n')[0] || '';
  const canonicalSku = compact(sku);
  const skuPattern = canonicalSku.length >= 4 ? new RegExp(`(?:^|[^a-z0-9])${[...canonicalSku].join('[-_\\s/]*')}(?![a-z0-9])`) : null;
  return { sku: canonicalSku, skuPattern, ids: identifiers(title + ' ' + (sku || '')), capacity: capacityOf(title) };
}
export function identityEvidence(query, doc, preparedQuery, preparedDoc) {
  const { ids, text, constraints } = preparedQuery || queryIdentity(query);
  const { skuPattern, ids: docIds, capacity } = preparedDoc || documentIdentity(doc);
  const exactSku = Boolean(skuPattern?.test(text));
  const matched = ids.filter(id => docIds.includes(id));
  const applicable = constraints.filter(c => c.ids.some(id => docIds.includes(id)));
  const wrongCapacity = applicable.length > 0 && applicable.every(c => c.capacity && capacity && c.capacity !== capacity);
  return { exactSku, matched: matched.length, requested: ids.length,
    conflict: doc.metadata?.sourceType === 'product' && (wrongCapacity || ids.length > 0 && matched.length === 0 && !exactSku) };
}
