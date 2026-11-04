import { readFile, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { VectorStore } from './vectorStore.interface.js';
import { atomicWriteJson, withFileLock, ragDataDirectory } from '../storage/atomicJson.js';
import { matchesFilter } from '../retrieval/text.js';

const validVector = v => Array.isArray(v) && v.length > 0 && v.every(Number.isFinite) && v.some(n => n !== 0);
function validate(records) {
  if (!Array.isArray(records)) throw new Error('Invalid vector index: expected array');
  const ids = new Set();
  let dimension;
  for (const r of records) {
    if (!r?.id || ids.has(r.id) || !validVector(r.vector) || typeof r.content !== 'string') throw new Error('Invalid vector record');
    if (dimension && r.vector.length !== dimension) throw new Error('Vector dimension mismatch');
    dimension = r.vector.length;
    ids.add(r.id);
  }
  return records;
}
function cosine(a, b) {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / Math.sqrt(aa * bb);
}

// Canonical vector snapshot. BM25 is derived and can always be rebuilt from it.
export class JsonVectorStore extends VectorStore {
  #filePath;
  #records;
  #stamp;
  #corpus;
  constructor({ dir } = {}) {
    super();
    this.#filePath = join(dir || ragDataDirectory(), 'vector-index.json');
    this.recovered = false;
  }
  get filePath() { return this.#filePath; }
  async recoverIndex() {
    return withFileLock(`${this.#filePath}.lock`, async () => {
      try { await this.#load(true); return false; } catch { /* preserve invalid snapshots */ }
      for (const path of [this.#filePath, `${this.#filePath}.bak`]) {
        try { await rename(path, `${path}.${Date.now()}.corrupt`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      await atomicWriteJson(this.#filePath, []);
      this.#stamp = undefined;
      await this.#load(true);
      this.recovered = true;
      return true;
    });
  }
  async #load(force = false) {
    let info;
    try { info = await stat(this.#filePath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const stamp = info ? `${info.mtimeMs}:${info.ctimeMs}:${info.size}` : 'missing';
    if (!force && this.#records && stamp === this.#stamp) return;
    let records;
    try { records = validate(JSON.parse(await readFile(this.#filePath, 'utf8'))); }
    catch (err) {
      try {
        records = validate(JSON.parse(await readFile(`${this.#filePath}.bak`, 'utf8')));
        this.recovered = true;
      } catch (backupError) {
        if (err.code === 'ENOENT' && backupError.code === 'ENOENT') records = [];
        else throw new Error(`Vector index corrupt; re-ingestion required: ${err.message}`);
      }
    }
    this.#records = new Map(records.map(r => [r.id, r]));
    this.#corpus = records.map(({ id, content, metadata }) => ({ id, content, metadata }));
    this.#stamp = stamp;
  }
  async #mutate(operation) {
    return withFileLock(`${this.#filePath}.lock`, async () => {
      await this.#load(true);
      const next = new Map(this.#records);
      const result = operation(next);
      const records = validate([...next.values()]);
      // Keep a valid previous generation for crash/corruption recovery.
      await atomicWriteJson(`${this.#filePath}.bak`, [...this.#records.values()]);
      await atomicWriteJson(this.#filePath, records);
      this.#stamp = undefined;
      await this.#load(true);
      return result;
    });
  }
  async upsert(records) {
    validate(records);
    return this.#mutate(next => { for (const r of records) next.set(r.id, r); return { upserted: records.length }; });
  }
  async replaceScope(records, { productIds, full = false } = {}) {
    validate(records);
    const scope = new Set(productIds);
    return this.#mutate(next => {
      for (const [id, r] of next) if (full || scope.has(r.metadata?.productId)) next.delete(id);
      for (const r of records) next.set(r.id, r);
      return { upserted: records.length };
    });
  }
  async delete(ids) {
    return this.#mutate(next => { let deleted = 0; for (const id of ids) if (next.delete(id)) deleted++; return { deleted }; });
  }
  async clear() { return this.#mutate(next => next.clear()); }
  async count() { await this.#load(); return this.#records.size; }
  async getAllContent() { await this.#load(); return this.#corpus; }
  async getRecords() { await this.#load(); return [...this.#records.values()]; }
  async search({ vector, topK = 5, filter }) {
    await this.#load();
    if (!validVector(vector)) throw new Error('search: valid vector is required');
    return [...this.#records.values()].filter(r => matchesFilter(r.metadata, filter))
      .map(r => ({ id: r.id, content: r.content, metadata: r.metadata, score: cosine(vector, r.vector) }))
      .sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK));
  }
}
