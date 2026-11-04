/**
 * In-process BM25 search engine for keyword-based retrieval.
 * Operates on the same corpus as the vector store — chunks with content + metadata.
 * Vietnamese text is tokenized by splitting on whitespace and punctuation (no
 * external NLP dependency). Good enough for technical product queries (model
 * numbers, brand names, specs) which are mostly ASCII/Latin tokens.
 */

const K1 = 1.5;
const B = 0.75;

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

export class BM25Index {
  #docs = [];
  #avgDl = 0;
  #df = new Map();
  #N = 0;

  build(documents) {
    this.#docs = documents.map(doc => {
      const tokens = tokenize(doc.content);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      return { id: doc.id, content: doc.content, metadata: doc.metadata, tokens, tf, dl: tokens.length };
    });

    this.#N = this.#docs.length;
    this.#avgDl = this.#N ? this.#docs.reduce((sum, d) => sum + d.dl, 0) / this.#N : 0;

    this.#df.clear();
    for (const doc of this.#docs) {
      const seen = new Set(doc.tokens);
      for (const t of seen) this.#df.set(t, (this.#df.get(t) || 0) + 1);
    }
  }

  search(query, topK = 5) {
    if (this.#N === 0) return [];

    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];

    const scores = [];
    for (const doc of this.#docs) {
      let score = 0;
      for (const qt of qTokens) {
        const df = this.#df.get(qt) || 0;
        if (df === 0) continue;
        const tf = doc.tf.get(qt) || 0;
        if (tf === 0) continue;
        const idf = Math.log((this.#N - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.dl / this.#avgDl)));
        score += idf * tfNorm;
      }
      if (score > 0) {
        scores.push({ id: doc.id, content: doc.content, metadata: doc.metadata, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  get size() { return this.#N; }
}
