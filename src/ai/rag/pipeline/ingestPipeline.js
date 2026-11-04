import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadProductDocuments, loadPolicyPageDocuments } from '../loaders/documentLoader.js';
import { chunkDocument } from '../chunking/textChunker.js';
import { GeminiEmbeddingProvider } from '../embeddings/gemini.embedding.js';
import { JsonVectorStore } from '../vectorstores/jsonVectorStore.js';
import { BM25Index } from '../retrieval/bm25.js';
import { atomicWriteJson, withFileLock, ragDataDirectory } from '../storage/atomicJson.js';

export class IngestPipeline {
  constructor({ dataDir, embeddingProvider, vectorStore, bm25Index, log = console.log,
    productLoader = loadProductDocuments, policyLoader = loadPolicyPageDocuments } = {}) {
    this.dataDir = dataDir || ragDataDirectory();
    // Lazy: deletes and BM25 repairs work without an embedding key.
    this.embeddingProvider = embeddingProvider;
    this.expectedDimension = embeddingProvider?.dimension || Number(process.env.EMBEDDING_DIMENSION) || (embeddingProvider ? null : 768);
    this.vectorStore = vectorStore || new JsonVectorStore({ dir: this.dataDir });
    this.bm25Index = bm25Index || new BM25Index();
    this.productLoader = productLoader;
    this.policyLoader = policyLoader;
    this.log = log;
  }
  async run({ productIds, skipEmbedding = false } = {}) {
    return withFileLock(join(this.dataDir, 'ingest.lock'), async () => {
      const start = Date.now();
      const incremental = Array.isArray(productIds);
      if (incremental && !productIds.length) throw new Error('productIds must not be empty');
      const products = await this.productLoader({ productIds });
      const policies = incremental ? [] : await this.policyLoader();
      const docs = [...products, ...policies];
      const chunks = docs.flatMap(doc => chunkDocument(doc));
      let old;
      try { old = await this.vectorStore.getRecords(); }
      catch (err) { this.log(`[Pipeline] ${err.message}; preserving corrupt snapshots and rebuilding.`); await this.vectorStore.recoverIndex(); old = []; }
      const byId = new Map(old.map(r => [r.id, r]));
      const records = [], missing = [];
      for (const chunk of chunks) {
        const previous = byId.get(chunk.id);
        // Verify actual vector presence and content; checkpoint hashes alone are insufficient.
        if (previous?.content === chunk.content && (!this.expectedDimension || previous.vector.length === this.expectedDimension)) {
          records.push({ ...previous, metadata: chunk.metadata });
        } else missing.push(chunk);
      }
      if (skipEmbedding) {
        // Explicit offline BM25 mode; do not alter canonical vectors.
        const scope = new Set(productIds);
        const corpus = incremental ? [...old.filter(r => !scope.has(r.metadata?.productId)), ...chunks] : chunks;
        this.bm25Index.build(corpus);
        await atomicWriteJson(join(this.dataDir, 'bm25-corpus.json'), corpus.map(({ id, content, metadata }) => ({ id, content, metadata })));
        return { documents: docs.length, chunks: chunks.length, embedded: 0, bm25Size: corpus.length, durationMs: Date.now() - start, mode: 'bm25-only' };
      }
      // Resume completed batches by id AND content, even when a previous job failed.
      let checkpoint = {};
      try { checkpoint = JSON.parse(await readFile(join(this.dataDir, 'ingest-checkpoint.json'), 'utf8')); } catch { /* regenerate */ }
      const staged = new Map((checkpoint.records || []).map(r => [r.id, r]));
      let embedded = 0;
      for (let i = 0; i < missing.length; i += 20) {
        const batch = missing.slice(i, i + 20);
        const reusable = c => {
          const r = staged.get(c.id);
          return r?.content === c.content && Array.isArray(r.vector) && r.vector.length > 0 && r.vector.every(Number.isFinite) && r.vector.some(v => v !== 0)
            && (!this.expectedDimension || r.vector.length === this.expectedDimension);
        };
        const uncached = batch.filter(c => !reusable(c));
        if (uncached.length) {
          this.embeddingProvider ||= new GeminiEmbeddingProvider();
          const vectors = await this.embeddingProvider.embed(uncached.map(c => c.content));
          if (vectors.length !== uncached.length) throw new Error('Embedding count mismatch');
          uncached.forEach((c, j) => staged.set(c.id, { ...c, vector: vectors[j] }));
          embedded += uncached.length;
          await atomicWriteJson(join(this.dataDir, 'ingest-checkpoint.json'), { records: [...staged.values()], timestamp: new Date().toISOString() });
        }
        for (const c of batch) records.push({ ...staged.get(c.id), metadata: c.metadata });
      }
      // One canonical commit removes only the requested products, including deactivated/deleted ones.
      await this.vectorStore.replaceScope(records, { productIds, full: !incremental });
      await this.repairBm25();
      await atomicWriteJson(join(this.dataDir, 'ingest-checkpoint.json'), { records: [] });
      const report = { documents: docs.length, chunks: chunks.length, embedded, cached: chunks.length - embedded,
        bm25Size: this.bm25Index.size, durationMs: Date.now() - start, timestamp: new Date().toISOString() };
      this.log(`[Pipeline] ${JSON.stringify(report)}`);
      return report;
    });
  }
  async runIncremental(productIds) {
    if (!productIds?.length) throw new Error('runIncremental requires productIds');
    return this.run({ productIds });
  }
  async removeProducts(productIds) {
    return withFileLock(join(this.dataDir, 'ingest.lock'), async () => {
      await this.vectorStore.replaceScope([], { productIds });
      await this.repairBm25();
    });
  }
  async repairBm25() {
    const corpus = await this.vectorStore.getAllContent();
    this.bm25Index.build(corpus);
    await atomicWriteJson(join(this.dataDir, 'bm25-corpus.json'), corpus);
    return corpus.length;
  }
  async loadBm25FromDisk() {
    try { this.bm25Index.build(JSON.parse(await readFile(join(this.dataDir, 'bm25-corpus.json'), 'utf8'))); return true; }
    catch { await this.repairBm25(); return this.bm25Index.size > 0; }
  }
}
