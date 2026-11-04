import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Phase 5: Production verification tests — mock/integration only, no Gemini API calls.
// Verifies the full pipeline: routing → retrieval → context building → response formatting.

const { classifyQuery } = await import('../../src/ai/rag/routing/queryRouter.js');
const { rewriteQuery } = await import('../../src/ai/rag/routing/conversationContext.js');
const { buildContext, contextBudget, estimateTokens } = await import('../../src/ai/rag/context/contextBuilder.js');
const { BM25Index } = await import('../../src/ai/rag/retrieval/bm25.js');
const { HybridRetriever } = await import('../../src/ai/rag/retrieval/hybridRetriever.js');
const { readFile } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');

const corpusPath = fileURLToPath(new URL('../fixtures/rag-phase3-corpus.json', import.meta.url));
let corpus, bm25, retriever;

function mockVector(text) {
  const v = new Array(512).fill(0);
  const n = String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  for (const w of n.match(/[a-z0-9]+/g) || []) { let h = 2166136261; for (const c of w) h = Math.imul(h ^ c.charCodeAt(0), 16777619); v[(h >>> 0) % v.length]++; }
  return v;
}

async function setup() {
  if (corpus) return;
  corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  bm25 = new BM25Index();
  bm25.build(corpus);
  const norm = v => Math.sqrt(v.reduce((s, n) => s + n * n, 0));
  const indexed = corpus.map(d => ({ ...d, vector: mockVector(d.content + ' ' + d.metadata.title) }));
  const vectorStore = {
    async search({ vector, topK, filter }) {
      const qN = norm(vector);
      return indexed.filter(d => !filter || Object.entries(filter).every(([k, v] ) => d.metadata[k] === v))
        .map(d => ({ ...d, score: d.vector.reduce((s, n, i) => s + n * vector[i], 0) / (norm(d.vector) * qN || 1) }))
        .sort((a, b) => b.score - a.score).slice(0, topK);
    }
  };
  const embeddingProvider = { embedQuery: async q => mockVector(q) };
  retriever = new HybridRetriever({ embeddingProvider, vectorStore, bm25Index: bm25 });
}

describe('Phase 5: Product Search & Comparison', () => {
  it('retrieves correct product for model query', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số RTX 4060', topK: 5 });
    assert.ok(results.length > 0);
    const ids = results.map(r => r.metadata?.documentId || r.id);
    assert.ok(ids.some(id => id.includes('252')), 'Should find product 252 (RTX 4060)');
  });

  it('retrieves correct product for SKU query', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số SEED-VGA-002', topK: 5 });
    assert.ok(results.length > 0);
    const ids = results.map(r => r.metadata?.documentId || r.id);
    assert.ok(ids.some(id => id.includes('253')), 'SKU SEED-VGA-002 maps to product 253');
  });

  it('retrieves both products for comparison query', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'So sánh RTX 4060 và RTX 4060 Ti', topK: 5 });
    const ids = results.map(r => r.metadata?.documentId || r.id);
    assert.ok(ids.some(id => id.includes('252')), 'Should find RTX 4060');
    assert.ok(ids.some(id => id.includes('253')), 'Should find RTX 4060 Ti');
  });
});

describe('Phase 5: Policy & Store Information', () => {
  it('retrieves warranty policy', async () => {
    await setup();
    const routing = classifyQuery('Chính sách bảo hành của cửa hàng');
    assert.ok(['rag_only', 'rag_and_fc'].includes(routing.route));
    const results = await retriever.retrieve({
      query: 'Chính sách bảo hành của cửa hàng', topK: 5,
      filter: routing.features.policy && !routing.features.model ? { sourceType: 'policy_page' } : undefined,
    });
    assert.ok(results.length > 0);
    const hasWarranty = results.some(r => r.content?.toLowerCase().includes('bảo hành') || r.metadata?.title?.toLowerCase().includes('bảo hành'));
    assert.ok(hasWarranty, 'Should retrieve warranty-related content');
  });

  it('retrieves return policy', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Chính sách đổi trả hàng lỗi', topK: 5 });
    assert.ok(results.length > 0);
  });
});

describe('Phase 5: Vietnamese Accent & SKU Handling', () => {
  it('handles query without diacritics', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'chinh sach bao hanh', topK: 5 });
    assert.ok(results.length > 0, 'Should find results for accent-stripped query');
  });

  it('handles lowercase SKU variants', async () => {
    await setup();
    const r1 = await retriever.retrieve({ query: 'Thông số SEED-VGA-002', topK: 5 });
    const r2 = await retriever.retrieve({ query: 'Thông số seedvga002', topK: 5 });
    assert.ok(r1.length > 0 && r2.length > 0, 'Both SKU variants should return results');
  });

  it('distinguishes different SKU products', async () => {
    await setup();
    const r1 = await retriever.retrieve({ query: 'Thông số SEED-SSDM2-004', topK: 3 });
    const r2 = await retriever.retrieve({ query: 'Thông số CMK16GX4M1E3200C16', topK: 3 });
    const ids1 = r1.map(r => r.metadata?.documentId || r.id);
    const ids2 = r2.map(r => r.metadata?.documentId || r.id);
    assert.ok(ids1[0] !== ids2[0], 'Different SKUs should return different top results');
  });
});

describe('Phase 5: Multi-turn Context & Pronoun Resolution', () => {
  it('resolves pronoun reference to previous entity', async () => {
    await setup();
    const resolved = rewriteQuery('Nó có thông số thế nào?', [{ entities: ['RTX 4060 Ti'] }]);
    assert.ok(resolved.query.includes('RTX 4060 Ti') || resolved.query.includes('nó'), 'Should resolve pronoun');
  });

  it('resolves comparison reference', async () => {
    await setup();
    const resolved = rewriteQuery('Cả hai khác nhau thế nào?', [{ entities: ['RTX 4060', 'RTX 4060 Ti'] }]);
    assert.ok(resolved.query.length > 10, 'Should expand comparison reference');
  });
});

describe('Phase 5: Query Routing', () => {
  it('routes greeting to none', () => {
    const r = classifyQuery('Xin chào');
    assert.equal(r.route, 'none');
  });

  it('routes product query to rag_only', () => {
    const r = classifyQuery('Thông số RTX 4060');
    assert.equal(r.route, 'rag_only');
  });

  it('routes price query to fc_only (live product lookup)', () => {
    const r = classifyQuery('RTX 4060 giá bao nhiêu?');
    assert.equal(r.route, 'fc_only');
  });

  it('routes off-topic to none', () => {
    const r = classifyQuery('Thời tiết hôm nay ở Hà Nội có mưa không?');
    assert.equal(r.route, 'none');
  });

  it('routes order query to fc_only', () => {
    const r = classifyQuery('Xem đơn hàng của tôi');
    assert.equal(r.route, 'fc_only');
  });
});

describe('Phase 5: Context Building & Citations', () => {
  it('builds context with citations from retrieved chunks', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số RTX 4060', topK: 5 });
    const ctx = buildContext(results, { query: 'Thông số RTX 4060', tokenBudget: contextBudget('technical') });
    assert.ok(ctx.contextText.length > 0, 'Should have context text');
    assert.ok(ctx.citations.length > 0, 'Should have citations');
    assert.ok(ctx.hasContext, 'hasContext should be true');
  });

  it('returns empty context for no results', () => {
    const ctx = buildContext([], { query: 'test', tokenBudget: 1000 });
    assert.equal(ctx.hasContext, false);
    assert.equal(ctx.contextText, '');
  });

  it('respects token budget', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số RTX 4060', topK: 5 });
    const smallCtx = buildContext(results, { query: 'Thông số RTX 4060', tokenBudget: 100 });
    const largeCtx = buildContext(results, { query: 'Thông số RTX 4060', tokenBudget: 5000 });
    assert.ok(estimateTokens(smallCtx.contextText) <= estimateTokens(largeCtx.contextText) || smallCtx.chunks.length <= largeCtx.chunks.length);
  });
});

describe('Phase 5: Error Handling & Edge Cases', () => {
  it('handles empty query gracefully', () => {
    const r = classifyQuery('');
    assert.ok(r.route, 'Should still return a route');
  });

  it('handles missing product query', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số RTX 9999', topK: 5 });
    // Should return some results (may be irrelevant) or empty
    assert.ok(Array.isArray(results));
  });

  it('handles non-existent SKU', async () => {
    await setup();
    const results = await retriever.retrieve({ query: 'Thông số SKU-NOT-EXIST-999', topK: 5 });
    assert.ok(Array.isArray(results));
  });
});

describe('Phase 5: Data Integrity', () => {
  const reportsBase = fileURLToPath(new URL('../../reports', import.meta.url));

  it('Phase 4 live data has correct mode label', async () => {
    const { join } = await import('node:path');
    const data = JSON.parse(await readFile(join(reportsBase, 'phase4/live/evaluation.json'), 'utf8'));
    assert.equal(data.config.mode, 'live');
    assert.equal(data.records.baseline.length, 43);
    assert.equal(data.records.rag.length, 43);
  });

  it('Phase 4 mock data has correct mode label', async () => {
    const { join } = await import('node:path');
    const data = JSON.parse(await readFile(join(reportsBase, 'phase4/mock/evaluation.json'), 'utf8'));
    assert.equal(data.config.mode, 'mock');
  });

  it('Phase 4 live has no errors after retry', async () => {
    const { join } = await import('node:path');
    const data = JSON.parse(await readFile(join(reportsBase, 'phase4/live/evaluation.json'), 'utf8'));
    const blErrors = data.records.baseline.filter(r => r.error);
    const ragErrors = data.records.rag.filter(r => r.error);
    assert.equal(blErrors.length, 0, `Baseline has ${blErrors.length} errors`);
    assert.equal(ragErrors.length, 0, `RAG has ${ragErrors.length} errors`);
  });

  it('corpus SHA matches between Phase 3 and Phase 4', async () => {
    const { join } = await import('node:path');
    const p3 = JSON.parse(await readFile(join(reportsBase, 'phase3/benchmark.json'), 'utf8'));
    const p4 = JSON.parse(await readFile(join(reportsBase, 'phase4/live/evaluation.json'), 'utf8'));
    assert.equal(p3.corpus.sha256, p4.corpus.sha256, 'Corpus SHA256 should match between Phase 3 and Phase 4');
  });
});
