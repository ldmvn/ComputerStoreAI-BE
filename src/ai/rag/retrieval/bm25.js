/**
 * In-process BM25 search engine for keyword-based retrieval.
 * Operates on the same corpus as the vector store — chunks with content + metadata.
 * Vietnamese accent folding, stop words and model/SKU terms require no NLP service.
 * Title, brand and SKU fields contribute alongside chunk text.
 */

const K1 = 1.5;
const B = 0.75;
import { tokenize, matchesFilter, identityEvidence, queryIdentity, documentIdentity } from './text.js';

export class BM25Index {
  #docs = [];
  #avgDl = 0;
  #df = new Map();
  #N = 0;

  build(documents) {
    this.#docs = documents.map(doc => {
      const tokens = tokenize(`${doc.content}\n${doc.metadata?.title || ''}\n${doc.metadata?.sku || ''}\n${doc.metadata?.brand || ''}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      return { id: doc.id, content: doc.content, metadata: doc.metadata, tokens, tf, dl: tokens.length, identity: documentIdentity(doc) };
    });

    this.#N = this.#docs.length;
    this.#avgDl = this.#N ? this.#docs.reduce((sum, d) => sum + d.dl, 0) / this.#N : 0;

    this.#df.clear();
    for (const doc of this.#docs) {
      const seen = new Set(doc.tokens);
      for (const t of seen) this.#df.set(t, (this.#df.get(t) || 0) + 1);
    }
  }

  search(query, topK = 5, filter) {
    if (this.#N === 0) return [];

    const qTokens = [...new Set(tokenize(query))];
    const identityQuery = queryIdentity(query);
    if (qTokens.length === 0) return [];

    const scores = [];
    for (const doc of this.#docs) {
      if (!matchesFilter(doc.metadata, filter)) continue;
      const identity = identityEvidence(query, doc, identityQuery, doc.identity);
      if (identity.conflict) continue;
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
      score += identity.exactSku ? 15 : identity.matched * 5;
      if (score > 0) {
        scores.push({ id: doc.id, content: doc.content, metadata: doc.metadata, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  get size() { return this.#N; }
}
