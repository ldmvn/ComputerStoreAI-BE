// Vector Store contract: upsert/search/delete/filter-by-metadata. Qdrant is
// the intended production adapter (see docs/ai-architecture.md) but is not
// stood up in this phase — no Docker, no network call. InMemoryVectorStore
// below is a real, working implementation of the same contract, used to
// exercise the Retriever/contextBuilder stages in tests without Qdrant.
// Swapping it for a QdrantVectorStore later means implementing this same
// class shape; nothing above the Vector Store layer needs to change.

export class VectorStore {
  /**
   * @param {{ id: string, vector: number[], content: string, metadata: object }[]} records
   */
  async upsert(_records) { throw new Error('VectorStore.upsert() is not implemented.'); }

  /**
   * @param {{ vector: number[], topK?: number, filter?: Record<string, unknown> }} query
   * @returns {Promise<{ id: string, content: string, metadata: object, score: number }[]>}
   */
  async search(_query) { throw new Error('VectorStore.search() is not implemented.'); }

  /** @param {string[]} ids */
  async delete(_ids) { throw new Error('VectorStore.delete() is not implemented.'); }

  /** @returns {Promise<number>} total indexed records, mostly for health/debug endpoints */
  async count() { throw new Error('VectorStore.count() is not implemented.'); }
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}.`);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function matchesFilter(metadata, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => metadata?.[key] === value);
}

// Real cosine-similarity search over an in-process Map. Not durable (lost on
// restart) and not meant for production scale — its job is to let the
// Retriever/contextBuilder stages be tested against real search behavior
// without standing up Qdrant.
export class InMemoryVectorStore extends VectorStore {
  constructor() {
    super();
    /** @type {Map<string, { id: string, vector: number[], content: string, metadata: object }>} */
    this._records = new Map();
  }

  async upsert(records) {
    for (const record of records) {
      if (!record?.id) throw new Error('upsert: every record needs an id.');
      if (!Array.isArray(record.vector) || record.vector.length === 0) throw new Error(`upsert: record "${record.id}" has no vector.`);
      this._records.set(record.id, { id: record.id, vector: record.vector, content: record.content, metadata: record.metadata ?? {} });
    }
    return { upserted: records.length };
  }

  async search({ vector, topK = 5, filter }) {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('search: vector is required.');
    const scored = [];
    for (const record of this._records.values()) {
      if (!matchesFilter(record.metadata, filter)) continue;
      scored.push({ id: record.id, content: record.content, metadata: record.metadata, score: cosineSimilarity(vector, record.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, topK));
  }

  async delete(ids) {
    let deleted = 0;
    for (const id of ids) { if (this._records.delete(id)) deleted++; }
    return { deleted };
  }

  async count() {
    return this._records.size;
  }
}
