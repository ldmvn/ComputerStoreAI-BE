import { GoogleGenAI } from '@google/genai';
import { EmbeddingProvider } from './embedding.interface.js';

const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSION = 768;
const MAX_BATCH_SIZE = 100;
const RATE_LIMIT_RETRY_MS = 61_000;
const MAX_RETRIES = 3;

export class GeminiEmbeddingProvider extends EmbeddingProvider {
  #ai;
  #model;
  #dimension;

  constructor({ apiKey, model, dimension } = {}) {
    super();
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is required for GeminiEmbeddingProvider.');
    this.#ai = new GoogleGenAI({ apiKey: key });
    this.#model = model || process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
    this.#dimension = dimension || Number(process.env.EMBEDDING_DIMENSION) || DEFAULT_DIMENSION;
  }

  get name() { return 'gemini'; }
  get dimension() { return this.#dimension; }

  async embed(texts) {
    if (!texts?.length) return [];

    const batches = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
    }

    const allVectors = [];
    for (const batch of batches) {
      const vectors = await this.#embedBatchWithRetry(batch);
      allVectors.push(...vectors);
    }
    return allVectors;
  }

  async #embedBatchWithRetry(texts, attempt = 0) {
    try {
      const response = await this.#ai.models.embedContent({
        model: this.#model,
        contents: texts,
        config: {
          abortSignal: AbortSignal.timeout(30_000),
          outputDimensionality: this.#dimension,
          taskType: 'RETRIEVAL_DOCUMENT',
        },
      });

      if (!response.embeddings?.length) {
        throw new Error(`Gemini embedding returned no embeddings for ${texts.length} texts.`);
      }

      return response.embeddings.map(e => e.values);
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes('429') || err.message?.toLowerCase().includes('rate');
      if (is429 && attempt < MAX_RETRIES) {
        const waitMs = RATE_LIMIT_RETRY_MS * (attempt + 1);
        console.warn(`[GeminiEmbedding] Rate limited, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, waitMs));
        return this.#embedBatchWithRetry(texts, attempt + 1);
      }
      throw err;
    }
  }

  async embedQuery(text) {
    const response = await this.#ai.models.embedContent({
      model: this.#model,
      contents: [text],
      config: {
        abortSignal: AbortSignal.timeout(Math.max(500, Number(process.env.RAG_QUERY_EMBEDDING_TIMEOUT_MS) || 4000)),
        outputDimensionality: this.#dimension,
        taskType: 'RETRIEVAL_QUERY',
      },
    });
    if (!response.embeddings?.[0]?.values) {
      throw new Error('Gemini embedding returned no vector for query.');
    }
    return response.embeddings[0].values;
  }
}
