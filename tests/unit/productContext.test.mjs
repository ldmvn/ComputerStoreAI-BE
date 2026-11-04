import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { indexedProducts, resolveProductQuery, matchesProductTarget } from '../../src/ai/rag/routing/productContext.js';
import { BM25Index } from '../../src/ai/rag/retrieval/bm25.js';
import { HybridRetriever } from '../../src/ai/rag/retrieval/hybridRetriever.js';
import { buildContext, validateCitations } from '../../src/ai/rag/context/contextBuilder.js';
const corpus = JSON.parse(await readFile(new URL('../fixtures/rag-phase3-corpus.json', import.meta.url), 'utf8'));
const catalog = indexedProducts(corpus);
const wd = catalog.find(p => p.productId === 244);
const turns = [{ products: [wd], entities: [wd.label] }];

for (const pronoun of ['Nó', 'Cái này', 'Sản phẩm đó', 'Con này', 'Ổ này']) {
  test(`${pronoun} retains WD SN850X 1TB productId/SKU and rewrites before retrieval`, () => {
    const r = resolveProductQuery(`${pronoun} có phù hợp chơi game không?`, turns, catalog);
    assert.equal(r.query, 'WD_BLACK SN850X 1TB có phù hợp chơi game không?');
    assert.equal(r.ambiguous, false);
    assert.equal(r.products[0].productId, 244);
    assert.equal(r.products[0].sku, 'SEED-SSDM2-003');
  });
}
test('original three questions retain both precise comparison targets', () => {
  const a = resolveProductQuery('WD_BLACK SN850X 1TB có những công nghệ nổi bật nào?', [], catalog);
  const b = resolveProductQuery('Nó có phù hợp chơi game không?', [a], catalog);
  const c = resolveProductQuery('So sánh nó với Samsung 990 Pro.', [a, b], catalog);
  assert.equal(c.query, 'So sánh WD_BLACK SN850X 1TB với Samsung 990 Pro.');
  assert.deepEqual(c.products.map(p => p.productId), [244, 249]);
  assert.deepEqual(c.products.map(p => p.capacity), [1000, 1000]);
});
test('capacity switch and exact SKU select 1TB and 2TB independently', () => {
  assert.equal(resolveProductQuery('Còn bản 2TB?', turns, catalog).products[0].productId, 245);
  assert.equal(resolveProductQuery('Thông số SEED-SSDM2-003', [], catalog).products[0].productId, 244);
  assert.equal(resolveProductQuery('Thông số SEED-SSDM2-004', [], catalog).products[0].productId, 245);
  const bm = new BM25Index(); bm.build(corpus);
  assert.ok(bm.search('WD_BLACK SN850X 1TB', 10).every(r => r.metadata.productId === 244));
  assert.ok(bm.search('Samsung 980 Pro 500GB', 10).every(r => r.metadata.productId === 242));
  assert.ok(bm.search('Samsung 990 Pro 1TB', 10).every(r => r.metadata.productId === 249));
});
test('a missing new comparison model is never replaced by a near model', () => {
  const r = resolveProductQuery('So sánh nó với Samsung 991 Pro', turns, catalog);
  assert.equal(r.products[0].productId, 244);
  assert.equal(r.products[1].productId, null);
  assert.equal(r.products[1].missing, true);
  assert.match(r.query, /Samsung 991 Pro/);
});
test('ask only for the ambiguous new capacity, keeping the prior product', () => {
  const samsung = catalog.find(p => p.productId === 249);
  const variants = [...catalog, { ...samsung, productId: 9999, title: 'Samsung 990 Pro 2TB', label: 'Samsung 990 Pro 2TB', capacity: 2000, sku: 'TEST-990-2TB' }];
  const r = resolveProductQuery('So sánh nó với Samsung 990 Pro.', turns, variants);
  assert.equal(r.ambiguous, true);
  assert.match(r.clarification, /Mình giữ WD_BLACK SN850X 1TB/);
  assert.match(r.clarification, /1TB, 2TB/);
  const clarified = resolveProductQuery('2TB', [r], variants);
  assert.equal(clarified.ambiguous, false);
  assert.deepEqual(clarified.products.map(p => p.productId), [244, 9999]);
});
test('new topic clears targets, courtesy preserves them and new session cannot inherit them', () => {
  const topic = resolveProductQuery('Thời tiết Hà Nội hôm nay?', turns, catalog);
  assert.deepEqual(topic.products, []);
  assert.equal(resolveProductQuery('Nó có tốt không?', [topic], catalog).ambiguous, true);
  assert.equal(resolveProductQuery('Nó có tốt không?', [], catalog).ambiguous, true);
  assert.equal(resolveProductQuery('Cảm ơn', turns, catalog).products[0].productId, 244);
});
test('semantic candidates and context assembly reject wrong productId/model/capacity', async () => {
  const bm = new BM25Index(); bm.build(corpus);
  const bad = { ...corpus.find(r => r.metadata.productId === 245), score: .99 };
  const good = { ...corpus.find(r => r.metadata.productId === 244), score: .8 };
  const forged = { ...bad, metadata: { ...bad.metadata, productId: 244 } };
  assert.equal(matchesProductTarget(forged, [wd]), false);
  const r = new HybridRetriever({ bm25Index: bm, embeddingProvider: { embedQuery: async () => [1, 0] }, vectorStore: { search: async () => [bad, forged, good] } });
  const hits = await r.retrieve({ query: 'WD_BLACK SN850X 1TB có phù hợp chơi game không?', products: [wd], filter: { productId: [244] } });
  assert.ok(hits.length > 0);
  assert.ok(hits.every(c => c.metadata.productId === 244 && /1TB/.test(c.metadata.title)));
  const context = buildContext([bad, forged, good], { products: [wd] });
  assert.equal(context.citations.length, 1);
  assert.equal(context.citations[0].productId, 244);
});
test('grouped Gemini citations preserve real sources and remove only invalid references', () => {
  const sources = [{ productId: 244 }, { productId: 249 }];
  const result = validateCitations('Dữ liệu [Nguồn 1, Nguồn 2, 99] và (Nguồn 2, 1).', sources);
  assert.deepEqual(result.citations.map(c => c.productId), [244, 249]);
  assert.deepEqual(result.invalid, [99]);
  assert.ok(!result.reply.includes('99'));
});
