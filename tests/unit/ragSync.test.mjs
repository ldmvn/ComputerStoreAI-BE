import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { withFileLock } from '../../src/ai/rag/storage/atomicJson.js';
import { JsonVectorStore } from '../../src/ai/rag/vectorstores/jsonVectorStore.js';
import { IngestPipeline } from '../../src/ai/rag/pipeline/ingestPipeline.js';
import { KnowledgeSync } from '../../src/ai/rag/sync/knowledgeSync.js';
import { HybridRetriever } from '../../src/ai/rag/retrieval/hybridRetriever.js';
import { BM25Index } from '../../src/ai/rag/retrieval/bm25.js';

const log = { log() {}, warn() {}, error() {} };
const record = (id, productId = Number(id)) => ({ id: String(id), content: `Product ${id} content`, vector: [1, 0], metadata: { productId } });
const document = (id, content = `Thông số sản phẩm số ${id}.`) => ({ id: `product:${id}`, sourceType: 'product', sourceRef: `product-${id}`, title: `Product ${id}`, productId: id, content,
  updatedAt: '2026-10-27T00:00:00Z', metadata: { sku: `SKU-${id}`, brand: 'Test' } });
async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ducmanh-rag-test-'));
  t.after(async () => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\ducmanh-rag-test-') || resolve(dir).startsWith(resolve(tmpdir()) + '/ducmanh-rag-test-')); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
function pipeline(dir, products, options = {}) {
  return new IngestPipeline({ dataDir: dir, productLoader: async ({ productIds }) => [...products.values()].filter(d => !productIds || productIds.includes(d.productId)),
    policyLoader: async () => [{ id: 'policy:warranty', sourceType: 'policy_page', sourceRef: 'warranty', title: 'Bảo hành', content: 'Bảo hành theo hóa đơn mua hàng.' }],
    embeddingProvider: { dimension: 2, embed: async texts => texts.map(() => [1, 0]) }, log() {}, ...options });
}
test('incremental create/update/delete keeps other products and policies in both indexes', async t => {
  const dir = await sandbox(t);
  const products = new Map([[1, document(1)], [2, document(2)]]);
  const p = pipeline(dir, products);
  await p.run();
  const live = new HybridRetriever({ embeddingProvider: { embedQuery: async () => { throw new Error('offline'); } }, vectorStore: new JsonVectorStore({ dir }), bm25Index: new BM25Index() });
  products.set(1, document(1, 'Thông số cập nhật hoàn toàn mới DDR5.'));
  products.set(3, document(3));
  await p.runIncremental([1, 3]);
  assert.equal((await live.retrieve({ query: 'SKU-3' }))[0].metadata.productId, 3);
  const corpus = JSON.parse(await readFile(join(dir, 'bm25-corpus.json'), 'utf8'));
  assert.ok(corpus.some(d => d.metadata.productId === 2));
  assert.ok(corpus.some(d => d.metadata.sourceType === 'policy_page'));
  assert.ok(corpus.some(d => d.content.includes('DDR5')));
  assert.equal(corpus.find(d => d.metadata.productId === 1).metadata.sku, 'SKU-1');
  await p.removeProducts([1]);
  assert.ok(!(await p.vectorStore.getRecords()).some(d => d.metadata.productId === 1));
  assert.equal(p.bm25Index.search('SKU-1').length, 0);
  assert.equal((await live.retrieve({ query: 'SKU-1' })).length, 0);
});
test('shorter descriptions and inactive products remove stale chunks regardless of index size', async t => {
  const dir = await sandbox(t);
  const products = new Map([[1, document(1, Array.from({ length: 90 }, (_, i) => `Đoạn mô tả độc lập ${i}. ` + 'x'.repeat(700)).join('\n\n'))], [2, document(2)]]);
  const p = pipeline(dir, products);
  await p.run();
  assert.ok((await p.vectorStore.count()) > 50);
  products.set(1, document(1));
  await p.runIncremental([1]);
  assert.equal((await p.vectorStore.getRecords()).filter(r => r.metadata.productId === 1).length, 1);
  products.delete(2);
  await p.runIncremental([2]);
  assert.ok(!(await p.vectorStore.getRecords()).some(r => r.metadata.productId === 2));
});
test('concurrent stores serialize writes and readers always see valid complete JSON', async t => {
  const dir = await sandbox(t);
  const a = new JsonVectorStore({ dir }), b = new JsonVectorStore({ dir });
  await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? a : b).upsert([record(i + 1)])));
  assert.equal(await a.count(), 15);
  assert.equal(await b.count(), 15);
  assert.equal(JSON.parse(await readFile(a.filePath, 'utf8')).length, 15);
  await assert.rejects(() => a.upsert([{ ...record(99), vector: [1, NaN] }]), /Invalid vector/);
  await assert.rejects(() => a.search({ vector: [1, 0, 0] }), /dimension mismatch/);
  assert.equal(await a.count(), 15);
});
test('corrupt/missing index recovery preserves evidence and repairs derived BM25', async t => {
  const dir = await sandbox(t);
  const p = pipeline(dir, new Map([[1, document(1)]]));
  await p.run();
  await p.vectorStore.upsert([record('extra', 7)]);
  await writeFile(p.vectorStore.filePath, '{corrupt');
  const restarted = new JsonVectorStore({ dir });
  assert.ok((await restarted.count()) > 0);
  assert.equal(restarted.recovered, true);
  await writeFile(p.vectorStore.filePath + '.bak', '{also corrupt');
  const rebuilt = pipeline(dir, new Map([[1, document(1)]]));
  await rebuilt.run();
  assert.ok((await readdir(dir)).some(f => f.endsWith('.corrupt')));
  await writeFile(join(dir, 'bm25-corpus.json'), 'broken');
  assert.equal(await rebuilt.loadBm25FromDisk(), true);
  assert.equal(JSON.parse(await readFile(join(dir, 'bm25-corpus.json'), 'utf8')).length, await rebuilt.vectorStore.count());
  await rm(rebuilt.vectorStore.filePath);
  await rm(rebuilt.vectorStore.filePath + '.bak');
  await rm(join(dir, 'bm25-corpus.json'));
  await rebuilt.run();
  assert.equal(await rebuilt.vectorStore.count(), 2);
});
test('failed embedding publishes no partial replacement; restart resumes completed batches', async t => {
  const dir = await sandbox(t);
  const products = new Map([[1, document(1)]]);
  const p = pipeline(dir, products);
  await p.run();
  const before = await readFile(p.vectorStore.filePath, 'utf8');
  products.set(1, document(1, Array.from({ length: 25 }, (_, i) => `${i}: ` + 'chi tiết mới '.repeat(50)).join('\n\n')));
  let batches = 0;
  const broken = pipeline(dir, products, { embeddingProvider: { dimension: 2, embed: async texts => { if (++batches === 2) throw new Error('quota'); return texts.map(() => [0, 1]); } } });
  await assert.rejects(() => broken.runIncremental([1]), /quota/);
  assert.equal(await readFile(p.vectorStore.filePath, 'utf8'), before);
  let resumedCount = 0;
  const restarted = pipeline(dir, products, { embeddingProvider: { dimension: 2, embed: async texts => { resumedCount += texts.length; return texts.map(() => [0, 1]); } } });
  const report = await restarted.runIncremental([1]);
  assert.equal(resumedCount, report.chunks - 20);
  assert.ok(report.chunks > 20);
  assert.ok(report.embedded < report.chunks);
});
test('durable jobs survive restart, retain failures, and process deletes during embedding outage', async t => {
  const dir = await sandbox(t);
  const products = new Map([[1, document(1)], [2, document(2)]]);
  const p = pipeline(dir, products);
  await p.run();
  const first = new KnowledgeSync({ dataDir: dir, pipeline: p, log });
  t.after(() => first.stop());
  first.queue(1); first.queue(2, 'delete'); first.stop();
  const broken = pipeline(dir, products, { embeddingProvider: { embed: async () => { throw new Error('offline'); } } });
  products.set(1, document(1, 'Sản phẩm được cập nhật mới.'));
  const second = new KnowledgeSync({ dataDir: dir, pipeline: broken, log });
  t.after(() => second.stop());
  assert.equal(second.recover(), 2);
  assert.match((await second.process()).error, /offline/);
  assert.equal(second.pending.size, 1);
  assert.ok(!(await broken.vectorStore.getRecords()).some(r => r.metadata.productId === 2));
  second.stop();
  const third = new KnowledgeSync({ dataDir: dir, pipeline: p, log });
  t.after(() => third.stop());
  assert.equal((await third.process()).synced, 1);
  assert.equal(third.recover(), 0);
});
test('an update queued during an in-flight sync is never acknowledged as completed', async t => {
  const dir = await sandbox(t);
  let sync;
  sync = new KnowledgeSync({ dataDir: dir, log, pipeline: { runIncremental: async () => { sync.queue(1); } } });
  t.after(() => sync.stop());
  sync.queue(1);
  const old = sync.pending.get(1).revision;
  const a = sync.process(), b = sync.process();
  assert.equal(a, b);
  await a;
  assert.notEqual(sync.pending.get(1).revision, old);
  assert.equal(sync.recover(), 1);
});

test('a killed writer leaves a recoverable OS-visible lease', async t => {
  const dir = await sandbox(t);
  const path = join(dir, 'dead.lock');
  const moduleUrl = new URL('../../src/ai/rag/storage/atomicJson.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { withFileLock } from ${JSON.stringify(moduleUrl)}; await withFileLock(process.argv[1], async () => { console.log('locked'); await new Promise(() => { setInterval(() => {}, 1000); }); });`, path], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child.stdout, 'data');
  const exited = once(child, 'exit');
  child.kill(); await exited;
  assert.equal(await withFileLock(path, async () => 'recovered'), 'recovered');
});

test('journal truncation and disk errors never escape the CRUD hook', async t => {
  const dir = await sandbox(t);
  const sync = new KnowledgeSync({ dataDir: dir, log, pipeline: { runIncremental: async () => {} } });
  t.after(() => sync.stop());
  await writeFile(sync.journal, '{"type":"queue","id":999');
  assert.doesNotThrow(() => sync.queue(1));
  assert.equal(sync.recover(), 1);
  assert.equal((await sync.process()).synced, 1);
  sync.append = () => { throw new Error('disk unavailable'); };
  assert.doesNotThrow(() => sync.queue(2));
  assert.equal(sync.pending.has(2), true);
});

test('recovery never resurrects a revision acknowledged by another worker', async t => {
  const dir = await sandbox(t);
  const a = new KnowledgeSync({ dataDir: dir, log }), b = new KnowledgeSync({ dataDir: dir, log, pipeline: { runIncremental: async () => {} } });
  t.after(() => { a.stop(); b.stop(); });
  a.queue(1);
  assert.equal(a.recover(), 1);
  await b.process();
  assert.equal(a.recover(), 0);
});

test('health CLI detects and repairs a derived index without AI or database calls', async t => {
  const dir = await sandbox(t);
  const p = pipeline(dir, new Map([[1, document(1)]]));
  await p.run();
  await writeFile(join(dir, 'bm25-corpus.json'), 'broken');
  const script = fileURLToPath(new URL('../../scripts/rag-index-health.mjs', import.meta.url));
  const execute = promisify(execFile);
  const opts = { env: { ...process.env, RAG_DATA_DIR: dir, GEMINI_API_KEY: '' }, windowsHide: true };
  await assert.rejects(() => execute(process.execPath, [script], opts), e => e.code === 1 && JSON.parse(e.stdout).aligned === false);
  const { stdout } = await execute(process.execPath, [script, '--repair'], opts);
  const report = JSON.parse(stdout);
  assert.equal(report.repaired, true);
  assert.equal(report.aligned, true);
  assert.equal(report.vectors, report.bm25Chunks);
});
