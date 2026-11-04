/**
 * Hybrid Retriever: combines Semantic (vector) search with BM25 (keyword)
 * search using Reciprocal Rank Fusion (RRF). Returns results with metadata
 * for RAG Triad Evaluation (query, context chunks, scores, retrieval method).
 */

const DEFAULT_RRF_K = 60;

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
  async retrieve({ query, topK = 5, filter, semanticTopK, bm25TopK } = {}) {
    if (!query?.trim()) throw new Error('retrieve: query must be a non-empty string.');

    const fetchK = Math.max(topK * 2, 10);
    const sTopK = semanticTopK || fetchK;
    const bTopK = bm25TopK || fetchK;

    const [semanticResults, bm25Results] = await Promise.all([
      this.#semanticSearch(query, sTopK, filter),
      Promise.resolve(this.#bm25Index.search(query, bTopK)),
    ]);

    const fused = reciprocalRankFusion(semanticResults, bm25Results, this.#rrfK);

    return fused.slice(0, topK).map(result => ({
      ...result,
      metadata: {
        ...result.metadata,
        retrievalMethod: result.retrieval.method,
      },
    }));
  }

  async #semanticSearch(query, topK, filter) {
    const vector = await this.#embeddingProvider.embedQuery(query);
    return this.#vectorStore.search({ vector, topK, filter });
  }
}
