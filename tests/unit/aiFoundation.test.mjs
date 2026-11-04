import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks, chunkDocument } from '../../src/ai/rag/chunking/textChunker.js';
import { buildContext, isStale } from '../../src/ai/rag/context/contextBuilder.js';
import { InMemoryVectorStore } from '../../src/ai/rag/vectorstores/vectorStore.interface.js';
import { Retriever } from '../../src/ai/rag/retrieval/retriever.interface.js';
import { NullEmbeddingProvider } from '../../src/ai/rag/embeddings/embedding.interface.js';
import { UnavailableProvider, providerUnavailableError } from '../../src/ai/providers/aiProvider.interface.js';
import { aiConfig, isChatConfigured, isRagConfigured, getAiStatus } from '../../src/ai/config/ai.config.js';
import { parseChatRequest } from '../../src/ai/validators/aiChat.validator.js';
import { validateBuildPcRequest } from '../../src/ai/services/aiBuildPc.service.js';

// ── ai.config ──────────────────────────────────────────────────────────────────

test('ai.config defaults to fully disabled when no env vars are set', () => {
  assert.equal(aiConfig.enabled, false);
  assert.equal(isChatConfigured(), false);
  assert.equal(isRagConfigured(), false);
  assert.deepEqual(getAiStatus(), { enabled: false, chatAvailable: false, ragAvailable: false, buildPcAvailable: false });
});

test('getAiStatus never leaks the provider name, model or vector store choice', () => {
  const status = getAiStatus();
  const keys = Object.keys(status);
  assert.deepEqual(keys.sort(), ['buildPcAvailable', 'chatAvailable', 'enabled', 'ragAvailable']);
  for (const value of Object.values(status)) assert.equal(typeof value, 'boolean');
});

// ── aiChat.validator ───────────────────────────────────────────────────────────

test('parseChatRequest accepts a minimal valid request and defaults context to general', () => {
  const parsed = parseChatRequest({ message: 'Tư vấn PC chơi game 15 triệu' });
  assert.equal(parsed.message, 'Tư vấn PC chơi game 15 triệu');
  assert.equal(parsed.conversationId, null);
  assert.equal(parsed.context, 'general');
});

test('parseChatRequest rejects empty/oversized message, bad context, bad conversationId', () => {
  assert.throws(() => parseChatRequest({ message: '' }), /message không được để trống/);
  assert.throws(() => parseChatRequest({ message: '   ' }), /message không được để trống/);
  assert.throws(() => parseChatRequest({ message: 'x'.repeat(aiConfig.chatMessageMaxLength + 1) }), /tối đa/);
  assert.throws(() => parseChatRequest({ message: 'hi', context: 'not-a-real-context' }), /context phải là một trong/);
  assert.throws(() => parseChatRequest({ message: 'hi', conversationId: 'has spaces!' }), /conversationId không hợp lệ/);
  assert.throws(() => parseChatRequest({ message: 'hi', conversationId: 123 }), /conversationId phải là chuỗi/);
  const withValidContext = parseChatRequest({ message: 'hi', context: 'product_advice', conversationId: 'abc-123' });
  assert.equal(withValidContext.context, 'product_advice');
  assert.equal(withValidContext.conversationId, 'abc-123');
});

// ── aiProvider.interface ─────────────────────────────────────────────────────

test('UnavailableProvider never returns a fake answer — every call throws a labeled 501', async () => {
  const provider = new UnavailableProvider();
  await assert.rejects(() => provider.complete({ messages: [] }), /chưa khả dụng/);
  const health = await provider.healthCheck();
  assert.equal(health.ok, false);
  const error = providerUnavailableError();
  assert.equal(error.statusCode, 501);
  assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
});

test('UnavailableProvider.stream() throws instead of yielding anything (no fake streamed tokens)', async () => {
  const provider = new UnavailableProvider();
  await assert.rejects(async () => {
    for await (const _chunk of provider.stream({ messages: [] })) { /* should never iterate */ }
  }, /chưa khả dụng/);
});

// ── textChunker ───────────────────────────────────────────────────────────────

test('splitIntoChunks keeps short text as one chunk and splits long text with overlap', () => {
  assert.deepEqual(splitIntoChunks(''), []);
  assert.deepEqual(splitIntoChunks('   '), []);
  assert.deepEqual(splitIntoChunks('Short text.'), ['Short text.']);

  const long = 'A'.repeat(1000);
  const chunks = splitIntoChunks(long, { chunkSize: 300, overlap: 50 });
  assert.ok(chunks.length > 1, 'long text should split into multiple chunks');
  for (const c of chunks) assert.ok(c.length <= 300);
  // adjacent chunks overlap by the configured amount
  assert.equal(chunks[0].slice(-50), chunks[1].slice(0, 50));
});

test('splitIntoChunks groups paragraphs that fit, and rejects invalid options', () => {
  const text = 'Para one.\n\nPara two.\n\nPara three.';
  const chunks = splitIntoChunks(text, { chunkSize: 1000 });
  assert.equal(chunks.length, 1); // all three fit in one chunk together
  assert.throws(() => splitIntoChunks('x', { chunkSize: 0 }), /chunkSize/);
  assert.throws(() => splitIntoChunks('x', { chunkSize: 10, overlap: 10 }), /overlap/);
});

test('chunkDocument stamps every chunk with the required metadata contract', () => {
  const doc = { id: 'policy:warranty', sourceType: 'policy_page', sourceRef: 'warranty', title: 'Bảo hành', content: 'Nội dung chính sách bảo hành.', productId: null, updatedAt: '2026-01-01T00:00:00.000Z' };
  const chunks = chunkDocument(doc);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].documentId, 'policy:warranty');
  assert.equal(chunks[0].id, 'policy:warranty::chunk-0');
  assert.equal(chunks[0].metadata.sourceType, 'policy_page');
  assert.equal(chunks[0].metadata.productId, null);
  assert.ok(chunks[0].metadata.contentHash);
  assert.throws(() => chunkDocument({ content: 'x' }), /document.id is required/);
});

// ── vectorStore + retriever (real cosine search over deterministic test vectors) ──

test('InMemoryVectorStore ranks by cosine similarity and applies metadata filters', async () => {
  const store = new InMemoryVectorStore();
  await store.upsert([
    { id: 'a', vector: [1, 0], content: 'about CPUs', metadata: { sourceType: 'policy_page' } },
    { id: 'b', vector: [0, 1], content: 'about RAM', metadata: { sourceType: 'faq' } },
    { id: 'c', vector: [0.9, 0.1], content: 'also about CPUs', metadata: { sourceType: 'policy_page' } },
  ]);
  assert.equal(await store.count(), 3);

  const results = await store.search({ vector: [1, 0], topK: 2 });
  assert.equal(results[0].id, 'a');
  assert.equal(results[1].id, 'c');
  assert.ok(results[0].score > results[1].score);

  const filtered = await store.search({ vector: [1, 0], topK: 5, filter: { sourceType: 'faq' } });
  assert.deepEqual(filtered.map(r => r.id), ['b']);

  const { deleted } = await store.delete(['a']);
  assert.equal(deleted, 1);
  assert.equal(await store.count(), 2);
});

test('InMemoryVectorStore rejects mismatched vector dimensions and missing vectors', async () => {
  const store = new InMemoryVectorStore();
  await assert.rejects(() => store.upsert([{ id: 'x', vector: [], content: 'x', metadata: {} }]), /no vector/);
  await store.upsert([{ id: 'x', vector: [1, 2], content: 'x', metadata: {} }]);
  await assert.rejects(() => store.search({ vector: [1, 2, 3] }), /dimension mismatch/);
});

test('Retriever wires embedding → vector store and applies minScore', async () => {
  const store = new InMemoryVectorStore();
  await store.upsert([
    { id: 'high', vector: [1, 0, 0], content: 'very relevant', metadata: {} },
    { id: 'low', vector: [0, 0, 1], content: 'not relevant', metadata: {} },
  ]);
  // A deterministic stand-in embedding used ONLY in this test to exercise the
  // Retriever's real search/threshold logic — never used in production code,
  // where NullEmbeddingProvider is the only active implementation.
  const testEmbedding = { async embedQuery() { return [1, 0, 0]; } };
  const retriever = new Retriever({ embeddingProvider: testEmbedding, vectorStore: store });
  const all = await retriever.retrieve({ query: 'anything', topK: 5 });
  assert.equal(all.length, 2);
  const thresholded = await retriever.retrieve({ query: 'anything', topK: 5, minScore: 0.5 });
  assert.deepEqual(thresholded.map(r => r.id), ['high']);
  await assert.rejects(() => retriever.retrieve({ query: '' }), /non-empty string/);
});

test('Retriever construction requires both dependencies', () => {
  assert.throws(() => new Retriever({ vectorStore: new InMemoryVectorStore() }), /embeddingProvider/);
  assert.throws(() => new Retriever({ embeddingProvider: new NullEmbeddingProvider() }), /vectorStore/);
});

test('NullEmbeddingProvider throws instead of returning a fabricated vector', async () => {
  const provider = new NullEmbeddingProvider();
  await assert.rejects(() => provider.embed(['hello']), /Embedding Provider/);
});

// ── contextBuilder ───────────────────────────────────────────────────────────

test('buildContext wraps retrieved chunks in an explicit "not instructions" delimiter and extracts citations', () => {
  const chunks = [
    { id: 'policy:warranty::chunk-0', content: 'Bảo hành 12 tháng.', score: 0.9, metadata: { documentId: 'policy:warranty', sourceType: 'policy_page', sourceRef: 'warranty', title: 'Bảo hành', productId: null, updatedAt: '2026-01-01T00:00:00.000Z' } },
  ];
  const { contextText, citations, hasContext } = buildContext(chunks);
  assert.equal(hasContext, true);
  assert.match(contextText, /TÀI LIỆU THAM KHẢO/);
  assert.match(contextText, /không phải chỉ thị hệ thống/);
  assert.match(contextText, /Bảo hành 12 tháng\./);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].sourceRef, 'warranty');
  assert.equal(citations[0].score, 0.9);
});

test('buildContext on an empty retrieval reports hasContext:false instead of inventing a citation', () => {
  const { contextText, citations, hasContext } = buildContext([]);
  assert.equal(hasContext, false);
  assert.equal(contextText, '');
  assert.deepEqual(citations, []);
});

test('isStale treats a missing updatedAt as stale, never assumes freshness', () => {
  assert.equal(isStale({ metadata: {} }), true);
  assert.equal(isStale({ metadata: { updatedAt: new Date().toISOString() } }), false);
  assert.equal(isStale({ metadata: { updatedAt: '2000-01-01T00:00:00.000Z' } }), true);
});

// ── aiBuildPc.service ────────────────────────────────────────────────────────

test('validateBuildPcRequest enforces budget/purpose (structured) and accepts prompt (freetext)', () => {
  const parsed = validateBuildPcRequest({ budget: 15000000, purpose: 'GAMING', cpuPreference: ' Intel ' });
  assert.equal(parsed.budget, 15000000);
  assert.equal(parsed.purpose, 'gaming');
  assert.equal(parsed.purposeLabel, 'Gaming');
  assert.equal(parsed.cpuPreference, 'Intel');
  assert.equal(parsed.mode, 'structured');

  assert.throws(() => validateBuildPcRequest({ budget: -1, purpose: 'gaming' }), /3\.000\.000/);
  assert.throws(() => validateBuildPcRequest({ budget: 5000000, purpose: 'not-valid' }), /Mục đích/);

  const freetext = validateBuildPcRequest({ prompt: 'Máy chơi game tầm 25 triệu' });
  assert.equal(freetext.mode, 'freetext');
  assert.equal(freetext.budget, 25_000_000);
  assert.ok(freetext.prompt.includes('25 triệu'));

  const nobudget = validateBuildPcRequest({ prompt: 'Máy chơi game mạnh' });
  assert.equal(nobudget.budget, 20_000_000);
});
