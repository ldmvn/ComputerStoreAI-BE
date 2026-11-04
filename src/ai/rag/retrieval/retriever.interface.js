// Retrieval stage: embeds a query and asks the Vector Store for the nearest
// chunks. Real, working logic — not a placeholder — but it is only ever as
// useful as the EmbeddingProvider/VectorStore it is given; with the default
// NullEmbeddingProvider it fails loudly (see embed() below) instead of
// returning fabricated results.

/**
 * @typedef {Object} RetrievedChunk
 * @property {string} id
 * @property {string} content
 * @property {object} metadata
 * @property {number} score          - cosine similarity, 0..1
 */

export class Retriever {
  /**
   * @param {{ embeddingProvider: import('../embeddings/embedding.interface.js').EmbeddingProvider,
   *           vectorStore: import('../vectorstores/vectorStore.interface.js').VectorStore }} deps
   */
  constructor({ embeddingProvider, vectorStore }) {
    if (!embeddingProvider) throw new Error('Retriever requires an embeddingProvider.');
    if (!vectorStore) throw new Error('Retriever requires a vectorStore.');
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
  }

  /**
   * Semantic search with optional metadata filtering and a minimum similarity
   * threshold. This is the full retrieval capability implemented in this
   * phase (Top-K + similarity score + metadata filter). Hybrid search
   * (keyword + vector) and reranking are real future extensions, not
   * implemented here — see the class doc comment.
   * @param {{ query: string, topK?: number, minScore?: number, filter?: Record<string, unknown> }} params
   * @returns {Promise<RetrievedChunk[]>}
   */
  async retrieve({ query, topK = 5, minScore = 0, filter } = {}) {
    if (!query?.trim()) throw new Error('retrieve: query must be a non-empty string.');
    const vector = await this.embeddingProvider.embedQuery(query);
    const results = await this.vectorStore.search({ vector, topK, filter });
    return results.filter(r => r.score >= minScore);
  }
}

// Future extension point: combine Retriever.retrieve() (dense/vector) with a
// keyword/BM25-style search over the same corpus, then merge-rank. Left
// unimplemented on purpose — building it now against data that isn't
// indexed yet would just be a placeholder pretending to be a feature.
export function hybridSearchNotImplemented() {
  const error = new Error('Hybrid search chưa được triển khai.');
  error.statusCode = 501;
  error.code = 'HYBRID_SEARCH_NOT_IMPLEMENTED';
  throw error;
}
