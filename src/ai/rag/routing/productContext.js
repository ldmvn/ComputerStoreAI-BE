import { identifiers, capacityOf, compact, normalize, documentIdentity } from '../retrieval/text.js';

const capacityLabel = gb => gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`;
export function productLabel(title) {
  const storage = title.match(/(?:WD[_ -]*Black\s+)?SN\d+[a-z0-9]*|Samsung\s+\d{3,4}\s+(?:Pro|Evo(?:\s+Plus)?|QVO)/i);
  if (!storage) return title.slice(0, 180);
  const family = storage[0].replace(/WD[_ -]*Black/i, 'WD_BLACK');
  return `${family}${capacityOf(title) ? ' ' + capacityLabel(capacityOf(title)) : ''}`;
}

// Build from actual indexed documents; legacy chunk metadata may not yet contain SKU.
export function indexedProducts(corpus) {
  const products = new Map();
  for (const chunk of corpus) {
    const m = chunk.metadata || {};
    if (m.sourceType !== 'product' || !m.productId || !m.title) continue;
    let product = products.get(m.productId);
    if (!product) {
      product = { productId: m.productId, title: m.title, label: productLabel(m.title), sourceRef: m.sourceRef,
        models: identifiers(m.title), capacity: capacityOf(m.title), sku: m.sku || null };
      products.set(m.productId, product);
    }
    product.sku ||= chunk.content?.match(/\bSKU:\s*([^\n]+)/i)?.[1]?.trim() || null;
  }
  return [...products.values()];
}

export function matchesProductTarget(chunk, targets) {
  if (chunk.metadata?.sourceType !== 'product') return false;
  const actual = documentIdentity(chunk);
  return targets.some(target => {
    if (target.productId && target.productId !== chunk.metadata?.productId) return false;
    if (target.models?.length && !target.models.some(id => actual.ids.includes(id))) return false;
    if (target.capacity && actual.capacity !== target.capacity) return false;
    if (target.sku && actual.sku && compact(target.sku) !== actual.sku) return false;
    return Boolean(target.productId || target.models?.length);
  });
}

function mention(part, catalog) {
  const skuMatch = catalog.filter(p => p.sku && documentIdentity({ metadata: { sku: p.sku } }).skuPattern?.test(normalize(part)));
  const ids = identifiers(part).filter(id => !/^ddr[345]$/.test(id));
  if (!ids.length && !skuMatch.length) return null;
  const capacity = capacityOf(part);
  const candidates = skuMatch.length ? skuMatch : catalog.filter(p => ids.some(id => p.models.includes(id)));
  const matching = candidates.filter(p => !capacity || p.capacity === capacity);
  if (matching.length === 1) return { ...matching[0], requestedLabel: part.trim() };
  const raw = part.match(/(?:WD[_ -]*Black\s+)?SN\d+[a-z0-9]*|Samsung\s+\d{3,4}\s+(?:Pro|Evo(?:\s+Plus)?|QVO)/i)?.[0];
  const label = raw ? `${raw}${capacity ? ' ' + capacityLabel(capacity) : ''}` : ids.join(' / ');
  return { productId: null, label, models: ids, capacity, sku: null, candidates: matching,
    missing: matching.length === 0, ambiguous: matching.length > 1 };
}

const CATEGORY_KEYWORDS = [
  [/\b(card|vga|rtx|gtx|geforce|radeon)\b/i, 'card màn hình'],
  [/\b(cpu|core i[3579]|ryzen|xeon)\b/i, 'CPU'],
  [/\b(ram|ddr[345])\b/i, 'RAM'],
  [/\b(ssd|hdd|nvme|o cung)\b/i, 'ổ cứng'],
  [/\b(mainboard|bo mach)\b/i, 'mainboard'],
  [/\b(nguon|psu)\b/i, 'nguồn'],
  [/\b(laptop)\b/i, 'laptop'],
  [/\b(man hinh|monitor)\b/i, 'màn hình'],
  [/\b(chuot|mouse)\b/i, 'chuột'],
  [/\b(ban phim|keyboard)\b/i, 'bàn phím'],
  [/\b(tai nghe|headset)\b/i, 'tai nghe'],
  [/\b(tan nhiet|cooler)\b/i, 'tản nhiệt'],
  [/\b(case|vo may)\b/i, 'case'],
];

function extractCategoryFromEntities(entities) {
  const text = normalize(entities.join(' '));
  for (const [pattern, label] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

const REF = /(?<![\p{L}\p{N}])(?:sản phẩm (?:đó|này|trên)|cái (?:này|đó)|con (?:này|đó)|ổ (?:này|đó)|mẫu (?:này|đó|trên)|nó)(?![\p{L}\p{N}])/giu;
const NREF = /\b(?:san pham (?:do|nay|tren)|cai (?:nay|do)|con (?:nay|do)|o (?:nay|do)|mau (?:nay|do|tren)|no)\b/;
const uniq = products => [...new Map(products.map(p => [p.productId || `${p.models?.join(',')}:${p.capacity}`, p])).values()];

export function resolveProductQuery(message, turns, catalog) {
  const text = String(message).trim(), n = normalize(text), last = turns.at(-1);
  const previous = last?.products || [];
  const recentProducts = uniq(turns.slice(-3).flatMap(t => t?.products || []));
  const reference = NREF.test(n);
  const plural = /\b(ca hai|hai con|2 con|hai san pham|2 san pham)\b/.test(n);
  const ordinal = /\b(con dau|con thu 1|con truoc|con sau|con thu 2)\b/.test(n);
  const comparison = /\b(so sanh|so voi|hon)\b/.test(n);
  const explicit = uniq(text.split(/\s+(?:với|và|so với|vs\.?|versus)\s+/iu).map(part => mention(part, catalog)).filter(Boolean));
  const elliptical = /^(con |the |vay |gia|bao hanh|co |ho tro|dung |choi |ban |phien ban |so voi)/.test(n) && !explicit.length;
  const courtesy = /^(cam on( ban)?|thanks?|ok|vang|da)[.!\s]*$/.test(n);
  const superlative = !explicit.length && /\b(re nhat|dat nhat|tot nhat|manh nhat|re hon|dat hon|tot hon|con nao re|con nao dat)\b/.test(n) && n.length < 40;
  const base = { query: text, rewritten: false, ambiguous: false, products: explicit, entities: explicit.map(p => p.label), historyTurns: 0, courtesy };
  if (courtesy) return { ...base, products: previous, entities: previous.map(p => p.label) };

  if (superlative && last?.entities?.length) {
    const category = extractCategoryFromEntities(last.entities);
    if (category) {
      return { ...base, query: `${category} ${text}`, rewritten: true, entities: [], historyTurns: 1 };
    }
  }

  let referents = [];
  const implicitComparison = comparison && !explicit.length && recentProducts.length > 1;
  if (reference || plural || ordinal || elliptical || implicitComparison || /^con so voi|^vay so voi|^so voi/.test(n)) {
    referents = (plural || comparison || implicitComparison) ? recentProducts : previous;
    if (ordinal) referents = /\b(con sau|con thu 2)\b/.test(n) ? previous.slice(1, 2) : previous.slice(0, 1);
    if (!referents.length && (reference || plural || ordinal)) {
      return { ...base, ambiguous: true, clarification: explicit.length ? `Bạn muốn so sánh ${explicit.map(p => p.label).join(' và ')} với sản phẩm nào?` : 'Bạn muốn hỏi sản phẩm nào? Vui lòng cho mình tên sản phẩm hoặc SKU.' };
    }
    if (referents.length > 1 && !plural && !ordinal && !comparison) {
      return { ...base, ambiguous: true, products: previous, clarification: `Bạn muốn nói đến ${previous.map(p => p.label).join(' hay ')}?${explicit.length ? ' Sản phẩm so sánh mới là ' + explicit.map(p => p.label).join(' và ') + '.' : ''}` };
    }
  }
  // "Còn bản 2TB?" changes only the capacity of the established family, never the model.
  if (elliptical && capacityOf(text) && referents.length === 1) {
    const p = referents[0];
    const family = p.label.replace(/\s+\d+(?:[.,]\d+)?\s*(?:TB|GB)\b/i, '');
    referents = [mention(`${family} ${capacityLabel(capacityOf(text))}`, catalog)].filter(Boolean);
  }
  let products = uniq([...referents, ...explicit]);
  if (!products.length && last?.pending?.length && capacityOf(text)) {
    products = last.pending.map(p => p.ambiguous ? mention(`${p.label} ${capacityLabel(capacityOf(text))}`, catalog) : p).filter(Boolean);
  }
  const ambiguous = products.find(p => p.ambiguous);
  if (ambiguous) {
    const choices = [...new Set(ambiguous.candidates.map(p => p.capacity ? capacityLabel(p.capacity) : p.label))];
    return { ...base, products: products.filter(p => !p.ambiguous), pending: products, ambiguous: true,
      clarification: `${products.filter(p => !p.ambiguous).length ? 'Mình giữ ' + products.filter(p => !p.ambiguous).map(p => p.label).join(' và ') + '. ' : ''}Bạn muốn ${ambiguous.label} phiên bản nào (${choices.join(', ')})?` };
  }
  let query = text;
  if (reference && referents.length === 1) query = text.replace(REF, () => referents[0].label);
  else if (ordinal || plural || elliptical || referents.length && comparison) query = `${text}\nĐối tượng: ${products.map(p => p.label).join('; ')}`;
  return { ...base, query, rewritten: query !== text, products, entities: products.map(p => p.label), historyTurns: referents.length ? 1 : 0 };
}
