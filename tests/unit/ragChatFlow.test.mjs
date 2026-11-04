import test from 'node:test';
import assert from 'node:assert/strict';
process.env.AI_ENABLED = 'true';
process.env.AI_PROVIDER = 'gemini';
process.env.AI_MODEL = 'mock';
const { createChatService } = await import('../../src/ai/services/aiChat.service.js');
const { ConversationMemory } = await import('../../src/ai/rag/routing/conversationContext.js');
const { BM25Index } = await import('../../src/ai/rag/retrieval/bm25.js');
const { HybridRetriever } = await import('../../src/ai/rag/retrieval/hybridRetriever.js');
const { buildContext, contextBudget } = await import('../../src/ai/rag/context/contextBuilder.js');

function setup() {
  const chunks = [
    { id: 'product:1::chunk-0', content: 'GPU RTX 4060 Ti sử dụng bộ nhớ GDDR6, công suất tham khảo 160W.', metadata: { documentId: 'product:1', productId: 1, sourceType: 'product', sourceRef: 'msi-4060ti', title: 'MSI RTX 4060 Ti', sku: 'MSI-4060-TI' } },
    { id: 'product:2::chunk-0', content: 'GPU RTX 4060 có bộ nhớ GDDR6.', metadata: { documentId: 'product:2', productId: 2, sourceType: 'product', sourceRef: 'asus-4060', title: 'ASUS RTX 4060' } },
    { id: 'policy:warranty::chunk-0', content: 'Bảo hành cần hóa đơn mua hàng.', metadata: { documentId: 'policy:warranty', sourceType: 'policy_page', sourceRef: 'warranty', title: 'Bảo hành' } },
  ];
  const index = new BM25Index(); index.build(chunks);
  let embeddingCalls = 0, retrievalCalls = 0, productCalls = 0;
  const retriever = new HybridRetriever({ bm25Index: index, embeddingProvider: { embedQuery: async () => { embeddingCalls++; throw new Error('mock outage'); } }, vectorStore: { search: async () => [] } });
  const requests = [], responses = [];
  const provider = { complete: async request => {
    requests.push(structuredClone(request));
    return responses.shift() || { content: 'Thông tin kỹ thuật [Nguồn 1]', usage: { promptTokens: 50, completionTokens: 10 } };
  } };
  const send = createChatService({ provider: () => provider, memory: new ConversationMemory(), ragReady: () => true,
    retrieve: async ({ query, complexity, ...rest }) => { retrievalCalls++; const diagnostics = {}; const hits = await retriever.retrieve({ query, ...rest, diagnostics }); return { ...buildContext(hits, { query, tokenBudget: contextBudget(complexity) }), diagnostics }; },
    tools: { search_products: { definition: { name: 'search_products' }, run: async () => { productCalls++; return { items: [{ id: 1, name: 'MSI RTX 4060 Ti', price: 9999999, stockStatus: 'IN_STOCK' }], total: 1 }; } },
      lookup_my_orders: { definition: { name: 'lookup_my_orders' }, run: async () => { throw new Error('đăng nhập'); } } },
  });
  return { send, requests, responses, counts: () => ({ embeddingCalls, retrievalCalls, productCalls }) };
}
test('end-to-end multi-turn knowledge uses one entity context and live prices come only from catalog tool', async () => {
  const s = setup();
  const first = await s.send({ message: 'Thông số RTX 4060 Ti' }, { userId: 1 });
  assert.equal(first.citations[0].productId, 1);
  const second = await s.send({ message: 'Nó tiêu thụ bao nhiêu watt?', conversationId: first.conversationId }, { userId: 1 });
  assert.equal(second.citations[0].productId, 1);
  assert.match(s.requests.at(-1).messages[1].content, /rtx4060ti/);
  assert.equal(s.requests.at(-1).messages.length, 2);
  assert.equal(s.requests.at(-1).tools, undefined);
  const retrievalBefore = s.counts().retrievalCalls;
  s.responses.push({ content: '', toolCalls: [{ name: 'search_products', arguments: { search: 'RTX 4060 Ti' } }] }, { content: 'Giá từ catalog: 9.999.999 đồng.' });
  const third = await s.send({ message: 'Còn giá và tồn kho?', conversationId: first.conversationId }, { userId: 1 });
  assert.equal(third._routing.route, 'fc_only');
  assert.equal(s.counts().retrievalCalls, retrievalBefore);
  assert.equal(s.counts().productCalls, 1);
  assert.equal(third.toolCalls[0].result.items[0].price, 9999999);
  assert.equal(third._metrics.geminiCalls, 2);
  assert.equal(third._metrics.rewriteCalls, 0);
  assert.equal(third._metrics.usageReported, false);
});
test('greetings and unrelated questions offer no tools, even if provider requests a forbidden one', async () => {
  const s = setup();
  s.responses.push({ content: '', toolCalls: [{ name: 'search_products', arguments: {} }] }, { content: 'Xin chào' });
  await s.send({ message: 'Xin chào' });
  assert.equal(s.counts().productCalls, 0);
  assert.equal(s.counts().retrievalCalls, 0);
  assert.equal(s.requests[0].tools, undefined);
  await s.send({ message: 'Viết thơ về mùa thu' });
  assert.equal(s.counts().retrievalCalls, 0);
});
test('ambiguous references cause clarification with zero retrieval, tools or Gemini calls', async () => {
  const s = setup();
  const first = await s.send({ message: 'So sánh RTX 4060 và RTX 4060 Ti' });
  const calls = s.requests.length, counts = s.counts();
  const second = await s.send({ message: 'Nó có tốt không?', conversationId: first.conversationId });
  assert.match(second.reply, /sản phẩm nào/);
  assert.equal(s.requests.length, calls);
  assert.deepEqual(s.counts(), counts);
});
test('citations must reference included context and unknown model cannot get a fabricated source', async () => {
  const s = setup();
  s.responses.push({ content: 'Chính sách [Nguồn 1], thêm [Nguồn 99]', usage: { promptTokens: 80, completionTokens: 20 } });
  const a = await s.send({ message: 'Chính sách bảo hành' });
  assert.equal(a.citations[0].sourceType, 'policy_page');
  assert.equal(a.citations.length, 1);
  assert.ok(!a.reply.includes('[Nguồn 99]'));
  assert.equal(a._metrics.promptTokens, 80);
  s.responses.push({ content: 'Không có dữ liệu [Nguồn 1]' });
  const b = await s.send({ message: 'Thông số RTX 9999' });
  assert.deepEqual(b.citations, []);
  assert.ok(!b.reply.includes('[Nguồn 1]'));
});
test('conversation owner boundary prevents a different user inheriting a referent', async () => {
  const s = setup();
  const first = await s.send({ message: 'Thông số RTX 4060 Ti' }, { userId: 1 });
  const n = s.requests.length;
  const second = await s.send({ message: 'Nó có thông số gì?', conversationId: first.conversationId }, { userId: 2 });
  assert.match(second.reply, /sản phẩm nào/);
  assert.equal(s.requests.length, n);
});
