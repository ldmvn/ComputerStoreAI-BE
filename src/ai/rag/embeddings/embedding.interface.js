// Embedding Provider contract — turns chunk text into vectors for the Vector
// Store. Deliberately no concrete OpenAI/Gemini embedding adapter exists yet
// (task scope: no real embedding calls in this phase); NullEmbeddingProvider
// is the only implementation, and it fails loudly rather than returning a
// fake vector, so nothing downstream can mistake "not configured" for "zero
// vector" and silently index garbage.
//
// `dimension` is intentionally NOT hardcoded anywhere in this module — it is
// a property of whichever embedding model eventually gets wired in (e.g.
// 1536 for text-embedding-3-small, 768 for a Gemini embedding model), so a
// real adapter must declare it itself.
export class EmbeddingProvider {
  /** @returns {string} */
  get name() { throw new Error('EmbeddingProvider.name is not implemented.'); }

  /** @returns {number} vector length this provider produces */
  get dimension() { throw new Error('EmbeddingProvider.dimension is not implemented.'); }

  /**
   * @param {string[]} texts
   * @returns {Promise<number[][]>} one vector per input text, same order
   */
  async embed(_texts) { throw new Error('EmbeddingProvider.embed() is not implemented.'); }

  /**
   * Embed a single query text (may use different taskType than document embedding).
   * @param {string} _text
   * @returns {Promise<number[]>} single vector
   */
  async embedQuery(_text) { throw new Error('EmbeddingProvider.embedQuery() is not implemented.'); }
}

export class NullEmbeddingProvider extends EmbeddingProvider {
  get name() { return 'null'; }
  get dimension() { return 0; }

  async embed() {
    const error = new Error('Không có Embedding Provider nào được cấu hình.');
    error.statusCode = 501;
    error.code = 'EMBEDDING_PROVIDER_UNAVAILABLE';
    throw error;
  }

  async embedQuery() { return this.embed(); }
}
