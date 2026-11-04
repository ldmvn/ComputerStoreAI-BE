import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BM25Index as BaselineBM25 } from '../fixtures/rag-phase2/bm25.js';
import { HybridRetriever as BaselineHybrid } from '../fixtures/rag-phase2/hybridRetriever.js';
import { classifyQuery as baselineRoute } from '../fixtures/rag-phase2/queryRouter.js';
import { buildContext as baselineContext } from '../fixtures/rag-phase2/contextBuilder.js';
import { BM25Index } from '../../src/ai/rag/retrieval/bm25.js';
import { HybridRetriever } from '../../src/ai/rag/retrieval/hybridRetriever.js';
import { classifyQuery } from '../../src/ai/rag/routing/queryRouter.js';
import { rewriteQuery } from '../../src/ai/rag/routing/conversationContext.js';
import { buildContext, contextBudget, estimateTokens } from '../../src/ai/rag/context/contextBuilder.js';
import { dataset } from './phase3.dataset.mjs';

const fixturePath = new URL('../fixtures/rag-phase3-corpus.json', import.meta.url);
const raw = await readFile(fixturePath, 'utf8');
const corpus = JSON.parse(raw);
const documentId = r => r.metadata?.documentId || r.id.split('::')[0];
// A deterministic mock semantic space, independent of relevance labels.
// It exercises fusion, caching and filtering; it does NOT measure Gemini semantic quality.
function mockVector(text) {
  const vector = new Array(512).fill(0);
  const normalized = String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  for (const word of normalized.match(/[a-z0-9]+/g) || []) {
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    vector[(h >>> 0) % vector.length]++;
  }
  return vector;
}
const norm = vector => Math.sqrt(vector.reduce((s, n) => s + n * n, 0));
const indexed = corpus.map(d => ({ ...d, vector: mockVector(d.content + ' ' + d.metadata.title) }));
const vectorStore = { async search({ vector, topK, filter }) {
  const qNorm = norm(vector);
  return indexed.filter(d => !filter || Object.entries(filter).every(([key, value]) => d.metadata[key] === value))
    .map(d => ({ ...d, score: d.vector.reduce((s, n, i) => s + n * vector[i], 0) / (norm(d.vector) * qNorm || 1) }))
    .sort((a, b) => b.score - a.score).slice(0, topK);
} };

function quality(rows) {
  const labelled = rows.filter(r => r.relevant.length);
  let recall = 0, mrr = 0, ndcg = 0;
  for (const row of labelled) {
    const ids = row.results.map(documentId);
    const relevant = new Set(row.relevant);
    const seen = new Set();
    let dcg = 0;
    ids.forEach((id, i) => { if (relevant.has(id) && !seen.has(id)) dcg += 1 / Math.log2(i + 2); seen.add(id); });
    const ideal = row.relevant.slice(0, 5).reduce((s, _, i) => s + 1 / Math.log2(i + 2), 0);
    recall += row.relevant.filter(id => ids.includes(id)).length / relevant.size;
    const rank = ids.findIndex(id => relevant.has(id));
    mrr += rank < 0 ? 0 : 1 / (rank + 1);
    ndcg += dcg / ideal;
  }
  const times = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  return { cases: rows.length, labelledRetrievalCases: labelled.length, recallAt5: recall / labelled.length, mrrAt5: mrr / labelled.length,
    ndcgAt5: ndcg / labelled.length, routingAccuracy: rows.filter(r => r.routing.route === r.expectedRoute).length / rows.length,
    latencyMs: { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * .95)] },
    embeddingCalls: rows.reduce((n, r) => n + r.embeddingCalls, 0), geminiCalls: 0,
    meanContextTokensEstimate: rows.reduce((n, r) => n + r.contextTokensEstimate, 0) / rows.length,
    unnecessaryToolOffers: rows.filter(r => r.expectedRoute === 'none' && r.offeredTools).length,
    emptyResultAccuracy: rows.filter(r => r.category === 'missing' && !r.results.length).length / rows.filter(r => r.category === 'missing').length,
  };
}
async function run(mode) {
  const baseline = mode === 'phase2';
  let calls = 0;
  const embeddingProvider = { embedQuery: async query => { calls++; return mockVector(query); } };
  const index = baseline ? new BaselineBM25() : new BM25Index();
  index.build(corpus);
  const retriever = baseline ? new BaselineHybrid({ embeddingProvider, vectorStore, bm25Index: index }) : new HybridRetriever({ embeddingProvider, vectorStore, bm25Index: index });
  const rows = [];
  for (const item of dataset) {
    const before = calls, start = performance.now();
    const resolved = baseline ? { query: item.query, rewritten: false } : rewriteQuery(item.query, item.history);
    const routing = baseline ? baselineRoute(item.query) : classifyQuery(item.query, { resolved });
    const useRag = ['rag_only', 'rag_and_fc'].includes(routing.route);
    const diagnostics = {};
    const results = useRag ? await retriever.retrieve({ query: resolved.query, topK: 5, rerank: mode !== 'phase3_no_rerank', diagnostics,
      filter: !baseline && routing.features.policy && !routing.features.model ? { sourceType: 'policy_page' } : undefined }) : [];
    let context = baseline ? baselineContext(results) : buildContext(results, { query: resolved.query, tokenBudget: contextBudget(routing.complexity) });
    if (baseline && context.contextText.length > 3000) context.contextText = context.contextText.slice(0, 3000) + '\n--- (đã rút gọn) ---';
    rows.push({ ...item, expectedRoute: item.route, routing, rewrittenQuery: resolved.query, results, contextText: context.contextText, citations: context.citations,
      selectedChunks: context.chunks || null, contextTokensEstimate: estimateTokens(context.contextText), embeddingCalls: calls - before, geminiCalls: 0, latencyMs: performance.now() - start,
      offeredTools: baseline ? routing.route !== 'rag_only' : Boolean(routing.toolNames.length), diagnostics,
      response: null, responseUsage: null, evaluation: { contextRelevance: null, groundedness: null, answerRelevance: null },
    });
  }
  return { summary: quality(rows), byCategory: Object.fromEntries([...new Set(rows.map(r => r.category))].map(cat => [cat, quality(rows.filter(r => r.category === cat))])), rows };
}
// Warm up both implementations; measured runs share no cache with the warm-up.
await run('phase2'); await run('phase3');
const before = await run('phase2'), after = await run('phase3'), ablation = await run('phase3_no_rerank');
const report = { generatedAt: new Date().toISOString(), corpus: { chunks: corpus.length, documents: new Set(corpus.map(documentId)).size,
  sha256: createHash('sha256').update(raw).digest('hex') },
  methodology: 'Frozen real corpus; document labels; top 5 chunks; deterministic hashed bag-of-words mock semantic embeddings; no AI network calls. Tokens are conservative UTF-8 byte/3 estimates, not Gemini billing. Latency excludes network and disk loading. Responses/triad scores remain null for Phase 4.',
  before: before.summary, after: after.summary, noRerank: ablation.summary, byCategory: { before: before.byCategory, after: after.byCategory } };
const out = fileURLToPath(new URL('../../reports/phase3/', import.meta.url));
await mkdir(out, { recursive: true });
await writeFile(join(out, 'benchmark.json'), JSON.stringify(report, null, 2));
await writeFile(join(out, 'triad-records.jsonl'), [...before.rows.map(r => ({ version: 'phase2', ...r })), ...after.rows.map(r => ({ version: 'phase3', ...r }))].map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ corpus: report.corpus, before: report.before, after: report.after, noRerank: report.noRerank }, null, 2));
if (after.summary.recallAt5 < before.summary.recallAt5 || after.summary.mrrAt5 < before.summary.mrrAt5) process.exitCode = 1;
