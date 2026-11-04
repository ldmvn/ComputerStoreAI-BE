import test from 'node:test';
import assert from 'node:assert/strict';

// Must set env BEFORE any ai module import (aiConfig is frozen at load time)
process.env.AI_ENABLED = 'true';
process.env.AI_PROVIDER = 'gemini';
process.env.AI_MODEL = 'mock-model';

const { createChatService, setProvider, getChatStatus } = await import('../../src/ai/services/aiChat.service.js');
const sendChatMessage = createChatService({ ragReady: () => false, tools: {
  search_products: { definition: { name: 'search_products' }, run: async () => ({ items: [], total: 0 }) },
  check_build_compatibility: { definition: { name: 'check_build_compatibility' }, run: async () => ({ compatible: true }) },
  lookup_my_orders: { definition: { name: 'lookup_my_orders' }, run: async (_, ctx) => { if (!ctx.userId) throw new Error('Vui lòng đăng nhập'); return { orders: [] }; } },
} });

class MockProvider {
  constructor(responses = []) {
    this.responses = responses;
    this.callCount = 0;
    this.calls = [];
  }
  get name() { return 'mock'; }
  async complete(request) {
    this.calls.push(request);
    const response = this.responses[this.callCount] ?? { content: 'Fallback', toolCalls: undefined };
    this.callCount++;
    return response;
  }
  async *stream() { yield { done: true, content: '', finishReason: 'stop' }; }
  async healthCheck() { return { ok: true, model: 'mock' }; }
}

class RateLimitProvider {
  get name() { return 'ratelimited'; }
  async complete() {
    const err = new Error('Vượt giới hạn request/phút (RPM). Vui lòng thử lại sau 1 phút.');
    err.statusCode = 429;
    err.code = 'AI_RATE_LIMITED';
    err.rateLimitType = 'RPM';
    err.retryAfterMs = 60000;
    throw err;
  }
  async *stream() { throw new Error('rate limited'); }
  async healthCheck() { return { ok: true }; }
}

// -- Simple chat (no tool calls) --
test('sendChatMessage returns direct reply when model makes no tool calls', async () => {
  setProvider(new MockProvider([{ content: 'Xin chào! Mình có thể giúp gì?', toolCalls: undefined }]));
  const result = await sendChatMessage({ message: 'Chào bạn', conversationId: null, context: 'general' });
  assert.equal(result.reply, 'Xin chào! Mình có thể giúp gì?');
  assert.ok(result.conversationId);
  assert.deepEqual(result.toolCalls, []);
});

// -- Single tool call round --
test('sendChatMessage executes tool calls and passes results back to model', async () => {
  const provider = new MockProvider([
    {
      content: '',
      toolCalls: [{ name: 'search_products', arguments: { search: 'RTX 4060' } }],
    },
    { content: 'Đây là kết quả tìm kiếm VGA RTX 4060.', toolCalls: undefined },
  ]);
  setProvider(provider);
  const result = await sendChatMessage({ message: 'Tìm VGA RTX 4060', conversationId: null });
  assert.equal(result.reply, 'Đây là kết quả tìm kiếm VGA RTX 4060.');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'search_products');
  assert.ok(result.toolCalls[0].result.items !== undefined || result.toolCalls[0].result.error !== undefined);
  assert.equal(provider.callCount, 2);
});

// -- Multi-turn tool calls (Build PC scenario) --
test('sendChatMessage supports multi-round tool calling up to MAX_TOOL_ROUNDS', async () => {
  const provider = new MockProvider([
    { content: '', toolCalls: [{ name: 'search_products', arguments: { category: 'cpu', maxPrice: 5000000 } }] },
    { content: '', toolCalls: [{ name: 'search_products', arguments: { category: 'mainboard' } }] },
    { content: '', toolCalls: [{ name: 'search_products', arguments: { category: 'ram' } }] },
    { content: 'Đây là cấu hình PC gợi ý.', toolCalls: undefined },
  ]);
  setProvider(provider);
  const result = await sendChatMessage({ message: 'Build PC gaming 15 triệu', conversationId: null });
  assert.equal(result.reply, 'Đây là cấu hình PC gợi ý.');
  assert.equal(result.toolCalls.length, 3);
  assert.equal(provider.callCount, 4);
});

// -- Tool call loop capped at 3 rounds --
test('sendChatMessage stops after MAX_TOOL_ROUNDS even if model keeps requesting tools', async () => {
  const infiniteTools = Array.from({ length: 10 }, () => ({
    content: '', toolCalls: [{ name: 'search_products', arguments: { search: 'test' } }],
  }));
  const provider = new MockProvider(infiniteTools);
  setProvider(provider);
  const result = await sendChatMessage({ message: 'Tìm RTX 4060', conversationId: null });
  // 3 rounds + 1 extra tool exec from forced summary + 1 final no-tools call = 5
  assert.ok(provider.callCount <= 5, `Expected at most 5 calls, got ${provider.callCount}`);
  assert.ok(result.toolCalls.length >= 3);
});

// -- Unknown tool name is skipped --
test('sendChatMessage skips unknown tool names gracefully', async () => {
  const provider = new MockProvider([
    { content: '', toolCalls: [{ name: 'nonexistent_tool', arguments: {} }] },
    { content: 'Không có công cụ phù hợp.', toolCalls: undefined },
  ]);
  setProvider(provider);
  const result = await sendChatMessage({ message: 'test unknown tool', conversationId: null });
  assert.equal(result.reply, 'Không có công cụ phù hợp.');
  assert.equal(result.toolCalls.length, 0);
});

// -- Rate limit error propagation --
test('sendChatMessage propagates 429 rate limit errors without retrying', async () => {
  setProvider(new RateLimitProvider());
  await assert.rejects(
    () => sendChatMessage({ message: 'test rate limit', conversationId: null }),
    (err) => {
      assert.equal(err.statusCode, 429);
      assert.equal(err.code, 'AI_RATE_LIMITED');
      assert.ok(err.rateLimitType);
      return true;
    }
  );
});

// -- Preserves conversationId --
test('sendChatMessage preserves provided conversationId', async () => {
  setProvider(new MockProvider([{ content: 'ok', toolCalls: undefined }]));
  const result = await sendChatMessage({ message: 'hi', conversationId: 'existing-conv-123' });
  assert.equal(result.conversationId, 'existing-conv-123');
});

// -- Tool call error handling --
test('sendChatMessage captures tool execution errors and passes them to model', async () => {
  const provider = new MockProvider([
    { content: '', toolCalls: [{ name: 'lookup_my_orders', arguments: {} }] },
    { content: 'Bạn cần đăng nhập để xem đơn hàng.', toolCalls: undefined },
  ]);
  setProvider(provider);
  const result = await sendChatMessage({ message: 'Xem đơn hàng', conversationId: null }, { userId: null });
  assert.equal(result.toolCalls.length, 1);
  assert.ok(result.toolCalls[0].result.error);
  assert.match(result.toolCalls[0].result.error, /đăng nhập/);
});
