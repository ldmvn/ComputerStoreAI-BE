import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'ducmanh-chat-http-'));
Object.assign(process.env, { AI_ENABLED: 'true', AI_PROVIDER: 'gemini', AI_MODEL: 'mock', RAG_ENABLED: 'true', RAG_DATA_DIR: dir, EMBEDDING_PROVIDER: '', GEMINI_API_KEY: 'mock', JWT_SECRET: 'mock-only-http-regression-secret' });
const corpus = JSON.parse(await readFile(new URL('./fixtures/rag-phase3-corpus.json', import.meta.url), 'utf8'));
await writeFile(join(dir, 'vector-index.json'), JSON.stringify(corpus.map(r => ({ ...r, vector: [1, 0] }))));
const { initializeRag } = await import('../src/ai/rag/rag.service.js');
const { GeminiProvider } = await import('../src/ai/providers/gemini.provider.js');
const { setProvider } = await import('../src/ai/services/aiChat.service.js');
const { aiRouter } = await import('../src/ai/routes/ai.routes.js');
const { createAccessToken } = await import('../src/services/token.service.js');
const sdkRequests = [], records = [];
setProvider(new GeminiProvider({ apiKey: 'mock', client: { models: { generateContent: async request => {
  const system = request.config.systemInstruction;
  const targetLine = system.split('\n').find(l => l.startsWith('Đối tượng người dùng đã xác định (JSON): '));
  const products = targetLine ? JSON.parse(targetLine.split('(JSON): ')[1]) : [];
  const sources = system.split('\n').filter(l => l.startsWith('{"source":')).map(JSON.parse);
  const query = request.contents.at(-1).parts[0].text;
  sdkRequests.push({ query, products, sources, systemInstruction: system });
  const content = products.length ? `Chào bạn, ${products.map(p => p.name).join(' so với ')}: thông tin từ tài liệu ${sources.map(p => `[Nguồn ${p.source}]`).join(' ')}.` : 'Mình có thể hỗ trợ thông tin máy tính.';
  return { candidates: [{ content: { role: 'model', parts: [{ text: content }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
} } } }));
await initializeRag();
const app = express(); app.use(express.json(), cookieParser()); app.use('/api/ai', aiRouter);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/api/ai/chat`;
const user7 = createAccessToken({ id: 7, role: 'CUSTOMER' }), user8 = createAccessToken({ id: 8, role: 'CUSTOMER' });
async function send(message, conversationId = null, token = user7, cookie = false) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `accessToken=${token}` } : token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ message, conversationId, context: 'general' }) });
  const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload));
  records.push({ message, sentConversationId: conversationId, owner: token === user8 ? 8 : token ? 7 : null, response: payload.data });
  return payload.data;
}
test('real HTTP route → auth → memory → Hybrid → Gemini SDK payload handles the reported conversation', async t => {
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\ducmanh-chat-http-') || resolve(dir).startsWith(resolve(tmpdir()) + '/ducmanh-chat-http-'));
    await rm(dir, { recursive: true, force: true });
  });
  const first = await send('WD_BLACK SN850X 1TB có những công nghệ nổi bật nào?');
  const second = await send('Nó có phù hợp chơi game không?', first.conversationId, user7, true);
  const third = await send('So sánh nó với Samsung 990 Pro.', second.conversationId);
  assert.equal(first.conversationId, second.conversationId); assert.equal(second.conversationId, third.conversationId);
  assert.match(first.reply, /^Chào bạn/);
  assert.ok(!/^(?:xin\s+)?chào/i.test(second.reply) && !/^(?:xin\s+)?chào/i.test(third.reply));
  for (const reply of [first, second]) {
    assert.ok(reply.citations.length > 0);
    assert.ok(reply.citations.every(c => c.productId === 244 && /1TB/.test(c.title)));
  }
  assert.deepEqual([...new Set(third.citations.map(c => c.productId))].sort(), [244, 249]);
  assert.equal(sdkRequests[1].query, 'WD_BLACK SN850X 1TB có phù hợp chơi game không?');
  assert.equal(sdkRequests[2].query, 'So sánh WD_BLACK SN850X 1TB với Samsung 990 Pro.');
  assert.deepEqual(sdkRequests[2].products.map(p => p.productId), [244, 249]);
  assert.ok(sdkRequests[2].sources.every(s => !/Samsung 980 Pro|SN850X 2TB/.test(s.title)));
  assert.match(sdkRequests[1].systemInstruction, /Không chào hỏi lại/);
  const count = sdkRequests.length;
  const otherUser = await send('Nó có tốt không?', first.conversationId, user8);
  assert.match(otherUser.reply, /sản phẩm nào/); assert.equal(sdkRequests.length, count);
  const newChat = await send('Nó có tốt không?');
  assert.notEqual(newChat.conversationId, first.conversationId); assert.equal(sdkRequests.length, count);
  const sku = await send('Thông số SEED-SSDM2-004', first.conversationId);
  assert.deepEqual([...new Set(sku.citations.map(c => c.productId))], [245]);
  const afterSku = await send('Cái này có phù hợp chơi game không?', first.conversationId);
  assert.ok(afterSku.citations.every(c => c.productId === 245));
  const gb500 = await send('Samsung 980 Pro 500GB có thông số gì?', first.conversationId);
  assert.ok(gb500.citations.length > 0 && gb500.citations.every(c => c.productId === 242));
  const gb1000 = await send('Samsung 980 Pro 1TB có thông số gì?', first.conversationId);
  assert.ok(gb1000.citations.length > 0 && gb1000.citations.every(c => c.productId === 243));
  await send('Thời tiết Hà Nội hôm nay thế nào?', first.conversationId);
  const count2 = sdkRequests.length;
  assert.match((await send('Sản phẩm đó có tốt không?', first.conversationId)).reply, /sản phẩm nào/);
  assert.equal(sdkRequests.length, count2);
  // Failed auth cannot reuse authenticated product context; no Auth implementation changed.
  assert.match((await send('Nó có tốt không?', third.conversationId, 'invalid-token')).reply, /sản phẩm nào/);
  await mkdir(new URL('../reports/multiturn-fix/', import.meta.url), { recursive: true });
  await writeFile(new URL('../reports/multiturn-fix/http-mock.json', import.meta.url), JSON.stringify({ mode: 'real HTTP/router/auth/retriever with mocked Gemini SDK; no AI network calls', records, sdkRequests }, null, 2));
});
