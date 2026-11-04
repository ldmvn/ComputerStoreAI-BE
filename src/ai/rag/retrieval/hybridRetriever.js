/**
 * Hybrid Retriever: combines Semantic (vector) search with BM25 (keyword)
 * search using Reciprocal Rank Fusion (RRF). Returns results with metadata
 * for RAG Triad Evaluation (query, context chunks, scores, retrieval method).
 */

const DEFAULT_RRF_K = 60;
import { identityEvidence, normalize, matchesFilter } from './text.js';
import { matchesProductTarget } from '../routing/productContext.js';

/**
 * Reciprocal Rank Fusion — merges two ranked result lists into one.
 * score(doc) = 1/(k + rank_semantic) + 1/(k + rank_bm25)
 * Documents appearing in only one list get a single-source score.
 */
function reciprocalRankFusion(semanticResults, bm25Results, k = DEFAULT_RRF_K) {
  const scores = new Map();
  const docs = new Map();

  for (let i = 0; i < semanticResults.length; i++) {
    const r = semanticResults[i];
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
    if (!docs.has(r.id)) docs.set(r.id, { ...r, semanticRank: i + 1, semanticScore: r.score });
    else docs.get(r.id).semanticRank = i + 1, docs.get(r.id).semanticScore = r.score;
  }

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
    if (!docs.has(r.id)) docs.set(r.id, { ...r, bm25Rank: i + 1, bm25Score: r.score });
    else docs.get(r.id).bm25Rank = i + 1, docs.get(r.id).bm25Score = r.score;
  }

  return [...docs.entries()]
    .map(([id, doc]) => ({
      id,
      content: doc.content,
      metadata: doc.metadata,
      score: scores.get(id),
      retrieval: {
        semanticRank: doc.semanticRank || null,
        semanticScore: doc.semanticScore || null,
        bm25Rank: doc.bm25Rank || null,
        bm25Score: doc.bm25Score || null,
        method: (doc.semanticRank && doc.bm25Rank) ? 'both' : (doc.semanticRank ? 'semantic' : 'bm25'),
      },
    }))
    .sort((a, b) => b.score - a.score);
}

export class HybridRetriever {
  #embeddingProvider;
  #vectorStore;
  #bm25Index;
  #rrfK;
  #cache = new Map();
  #inflight = new Map();

  constructor({ embeddingProvider, vectorStore, bm25Index, rrfK = DEFAULT_RRF_K }) {
    if (!embeddingProvider) throw new Error('HybridRetriever requires an embeddingProvider.');
    if (!vectorStore) throw new Error('HybridRetriever requires a vectorStore.');
    if (!bm25Index) throw new Error('HybridRetriever requires a bm25Index.');
    this.#embeddingProvider = embeddingProvider;
    this.#vectorStore = vectorStore;
    this.#bm25Index = bm25Index;
    this.#rrfK = rrfK;
  }

  /**
   * @param {{ query: string, topK?: number, filter?: Record<string, unknown>, semanticWeight?: number, bm25Weight?: number }} params
   * @returns {Promise<Array<{ id, content, metadata, score, retrieval }>>}
   */
  async retrieve({ query, topK = 5, filter, products, semanticTopK, bm25TopK, rerank = true, minSemanticScore = 0.35, diagnostics = {} } = {}) {
    if (!query?.trim()) throw new Error('retrieve: query must be a non-empty string.');
    const started = performance.now();
    topK = Math.min(20, Math.max(1, topK));
    const fetchK = Math.max(topK * 2, 10);
    const sTopK = semanticTopK || fetchK;
    const bTopK = bm25TopK || fetchK;

    if (this.#vectorStore.getAllContent) {
      const corpus = await this.#vectorStore.getAllContent();
      if (corpus !== this.corpus) {
        // Preserve a recovered lexical snapshot until background source reconciliation
        // can replace a missing vector index. Later empty commits still remove all docs.
        if (corpus.length || this.corpus !== undefined || !this.#bm25Index.size) this.#bm25Index.build(corpus);
        this.corpus = corpus;
      }
    }
    const lexical = this.#bm25Index.search(query, bTopK, filter);
    const exactSku = lexical.some(d => identityEvidence(query, d).exactSku);
    diagnostics.embeddingCalls = 0;
    const [semantic, keywords] = await Promise.allSettled([
      exactSku || this.corpus?.length === 0 ? Promise.resolve([]) : this.#semanticSearch(query, sTopK, filter, diagnostics),
      Promise.resolve(lexical),
    ]);
    const permitted = r => matchesFilter(r.metadata, filter) && (!products?.length || matchesProductTarget(r, products));
    const semanticResults = semantic.status === 'fulfilled' ? semantic.value.filter(r => permitted(r) && r.score >= minSemanticScore && !identityEvidence(query, r).conflict) : [];
    const bm25Results = keywords.status === 'fulfilled' ? keywords.value.filter(permitted) : [];
    diagnostics.semanticDegraded = semantic.status === 'rejected';
    const fused = reciprocalRankFusion(semanticResults, bm25Results, this.#rrfK);
    if (rerank) {
      for (const result of fused) {
        const evidence = identityEvidence(query, result);
        result.retrieval.rrfScore = result.score;
        result.score += evidence.exactSku ? 0.08 : evidence.matched * 0.025;
        result.retrieval.identity = evidence;
      }
      fused.sort((a, b) => b.score - a.score);
    }
    diagnostics.latencyMs = performance.now() - started;
    diagnostics.candidates = fused.length;
    const groups = new Map();
    for (const r of fused) {
      const key = r.metadata?.documentId || r.metadata?.productId || r.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const diverse = [];
    for (let round = 0; round < 3 && diverse.length < topK; round++) {
      for (const group of groups.values()) if (group[round]) diverse.push(group[round]);
    }
    return diverse.slice(0, topK).map(result => ({
      ...result,
      metadata: {
        ...result.metadata,
        retrievalMethod: result.retrieval.method,
      },
    }));
  }

  async #semanticSearch(query, topK, filter, diagnostics) {
    const key = normalize(query).trim();
    const entry = this.#cache.get(key);
    let vector;
    if (entry && Date.now() - entry.at < 300_000) {
      vector = entry.vector;
      diagnostics.embeddingCacheHit = true;
    } else {
      let pending = this.#inflight.get(key);
      if (!pending) {
        diagnostics.embeddingCalls++;
        pending = Promise.resolve().then(() => this.#embeddingProvider.embedQuery(query));
        this.#inflight.set(key, pending);
      }
      try {
        vector = await pending;
        if (this.#cache.size >= 256) this.#cache.delete(this.#cache.keys().next().value);
        this.#cache.set(key, { vector, at: Date.now() });
      } finally { this.#inflight.delete(key); }
    }
    return this.#vectorStore.search({ vector, topK, filter });
  }
}
