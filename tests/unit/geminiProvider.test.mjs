import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../../src/ai/providers/gemini.provider.js';

for (const [message, type] of [['limit per day', 'RPD'], ['limit per minute', 'RPM'], ['token limit', 'TPM']]) {
  test(`GeminiProvider maps mocked quota error to ${type}`, async () => {
    const client = { models: { generateContent: async () => { throw Object.assign(new Error(message), { status: 429 }); } } };
    const provider = new GeminiProvider({ apiKey: 'mock', model: 'mock', client });
    await assert.rejects(() => provider.complete({ messages: [{ role: 'user', content: 'hi' }] }), e => e.statusCode === 429 && e.rateLimitType === type);
  });
}
test('GeminiProvider reports actual usage and preserves raw function-call parts', async () => {
  const raw = { role: 'model', parts: [{ functionCall: { name: 'search_products', args: { search: 'RTX 4060' } } }] };
  const client = { models: { generateContent: async () => ({ candidates: [{ content: raw }], usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45 } }) } };
  const provider = new GeminiProvider({ apiKey: 'mock', client });
  const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(result.usage, { promptTokens: 123, completionTokens: 45 });
  assert.equal(result._rawModelContent, raw);
  assert.equal(result.toolCalls[0].name, 'search_products');
});
test('GeminiProvider health check is mock-only and returns failure details', async () => {
  const provider = new GeminiProvider({ apiKey: 'mock', client: { models: { generateContent: async () => { throw new Error('offline'); } } } });
  assert.deepEqual(await provider.healthCheck(), { ok: false, reason: 'offline' });
});
