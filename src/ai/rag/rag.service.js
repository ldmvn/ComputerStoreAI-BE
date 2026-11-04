// RAG orchestrator — wires the Hybrid RAG pipeline into the chatbot.
// Phase 2: real components (GeminiEmbedding, JsonVectorStore, BM25, HybridRetriever).
//
// When RAG_ENABLED=false or the index hasn't loaded yet, queryRag() returns
// empty context instead of throwing — the chatbot continues working with
// Function Calling alone. This is the graceful degradation contract.

import { aiConfig } from '../config/ai.config.js';
import { GeminiEmbeddingProvider } from './embeddings/gemini.embedding.js';
import { NullEmbeddingProvider } from './embeddings/embedding.interface.js';
import { JsonVectorStore } from './vectorstores/jsonVectorStore.js';
import { BM25Index } from './retrieval/bm25.js';
import { HybridRetriever } from './retrieval/hybridRetriever.js';
import { buildContext, contextBudget } from './context/contextBuilder.js';
import { atomicWriteJson, ragDataDirectory } from './storage/atomicJson.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { indexedProducts } from './routing/productContext.js';

const DATA_DIR = ragDataDirectory();
const BM25_FILE = join(DATA_DIR, 'bm25-corpus.json');

let embeddingProvider = null;
let vectorStore = null;
let bm25Index = null;
let hybridRetriever = null;
let ragReady = false;
let productCorpus, productCatalog = [];

const EMPTY_CONTEXT = { contextText: '', citations: [], hasContext: false };

export function isRagReady() { return ragReady; }

/**
 * Initialize RAG components and load indexes from disk.
 * Called once at server startup from bootstrap.js.
 */
export async function initializeRag() {
  if (!aiConfig.ragEnabled) {
    console.log('[RAG] Disabled — RAG_ENABLED is not set.');
    return false;
  }

  try {
    // Vector store loads from JSON file on first access
    vectorStore = new JsonVectorStore({ dir: DATA_DIR });
    let indexCount;
    try { indexCount = await vectorStore.count(); }
    catch (err) { console.error('[RAG]', err.message); await vectorStore.recoverIndex(); indexCount = 0; }

    // Keep the retriever alive with an empty store so background repair is visible.

    // BM25 index loads from corpus file
    bm25Index = new BM25Index();
    const corpus = await vectorStore.getAllContent();
    if (corpus.length) {
      bm25Index.build(corpus);
      // Rebuild from canonical vectors; persistence failure must not disable retrieval.
      try { await atomicWriteJson(BM25_FILE, corpus); }
      catch (err) { console.warn('[RAG] BM25 persistence unavailable:', err.message); }
    } else {
      try {
        const saved = JSON.parse(await readFile(BM25_FILE, 'utf8'));
        if (!Array.isArray(saved) || saved.some(r => !r.id || typeof r.content !== 'string' || !r.metadata)) throw new Error('Invalid lexical corpus');
        bm25Index.build(saved);
      } catch { console.warn('[RAG] No usable index; background reconciliation will rebuild from sources.'); }
    }

    // Embedding provider for query-time embedding
    if (aiConfig.embeddingProvider === 'gemini') {
      try { embeddingProvider = new GeminiEmbeddingProvider(); }
      catch { embeddingProvider = new NullEmbeddingProvider(); }
    } else {
      embeddingProvider = new NullEmbeddingProvider();
      console.warn('[RAG] No embedding provider configured. Semantic search disabled.');
    }

    hybridRetriever = new HybridRetriever({
      embeddingProvider,
      vectorStore,
      bm25Index,
    });

    ragReady = true;
    console.log(`[RAG] Ready — ${indexCount} vectors, ${bm25Index.size} BM25 docs.`);
    return true;
  } catch (err) {
    console.error('[RAG] Initialization failed:', err.message);
    ragReady = false;
    return false;
  }
}

/**
 * Retrieves grounded context for a user query via Hybrid RAG.
 * Returns empty context (never throws) if RAG is not ready — the chatbot
 * falls back to Function Calling seamlessly.
 */
export async function queryRag({ query, topK = 5, filter, products, complexity = 'simple' } = {}) {
  if (!ragReady || !hybridRetriever) return EMPTY_CONTEXT;

  try {
    const diagnostics = {};
    const chunks = await hybridRetriever.retrieve({ query, topK, filter, products, diagnostics });
    const context = buildContext(chunks, { tokenBudget: contextBudget(complexity), query, products });
    return { ...context, diagnostics: { ...diagnostics, contextTokensEstimate: context.estimatedTokens, selectedChunks: context.chunks.length } };
  } catch (err) {
    console.error('[RAG] Query failed (degrading gracefully):', err.message);
    return EMPTY_CONTEXT;
  }
}

export async function getIndexedChunkCount() {
  return vectorStore ? vectorStore.count() : 0;
}

export function getVectorStore() { return vectorStore; }
export function getBm25Index() { return bm25Index; }
export async function getIndexedProducts() {
  if (!vectorStore) return [];
  try {
    const corpus = await vectorStore.getAllContent();
    if (corpus !== productCorpus) { productCatalog = indexedProducts(corpus); productCorpus = corpus; }
    return productCatalog;
  } catch { return []; }
}
