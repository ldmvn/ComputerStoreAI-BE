import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvaluationEngine } from '../evaluation/phase4/engine.mjs';

describe('Phase 4 Evaluation Engine (mock mode)', () => {
  let engine;

  it('initializes with corpus', async () => {
    engine = new EvaluationEngine({ mode: 'mock' });
    const info = await engine.initialize();
    assert.ok(info.chunks > 0, 'Should have chunks');
    assert.ok(info.documents > 0, 'Should have documents');
    assert.ok(info.sha256, 'Should have SHA256');
  });

  it('retrieves context for a model query', async () => {
    const item = { id: 'test-1', query: 'Thông số RTX 4060', relevant: ['product:252'], route: 'rag_only', history: [], category: 'model' };
    const retrieval = await engine.retrieve(item);
    assert.ok(retrieval.results.length > 0, 'Should retrieve chunks');
    assert.ok(retrieval.context.contextText.length > 0, 'Should have context text');
    assert.ok(retrieval.routing.route, 'Should have routing');
  });

  it('retrieves empty context when useRag=false', async () => {
    const item = { id: 'test-2', query: 'Thông số RTX 4060', relevant: ['product:252'], route: 'rag_only', history: [], category: 'model' };
    const retrieval = await engine.retrieve(item, { useRag: false });
    assert.equal(retrieval.results.length, 0);
    assert.equal(retrieval.context.contextText, '');
  });

  it('evaluates a single item end-to-end', async () => {
    const item = { id: 'test-3', query: 'Thông số RTX 4060', relevant: ['product:252'], route: 'rag_only', history: [], category: 'model' };
    const result = await engine.evaluateItem(item, { useRag: true });
    assert.equal(result.id, 'test-3');
    assert.ok(result.response, 'Should have response');
    assert.ok(result.evaluation.contextRelevance, 'Should have context relevance');
    assert.ok(result.evaluation.groundedness, 'Should have groundedness');
    assert.ok(result.evaluation.answerRelevance, 'Should have answer relevance');
  });

  it('evaluates baseline (no RAG) item', async () => {
    const item = { id: 'test-4', query: 'Xin chào', relevant: [], route: 'none', history: [], category: 'negative' };
    const result = await engine.evaluateItem(item, { useRag: false });
    assert.equal(result.evaluation.contextRelevance.reason, 'no_retrieval');
    assert.ok(result.response);
  });

  it('evaluates negative/missing query correctly', async () => {
    const item = { id: 'test-5', query: 'Thông số RTX 9999', relevant: [], route: 'rag_only', history: [], category: 'missing' };
    const result = await engine.evaluateItem(item, { useRag: true });
    assert.equal(result.id, 'test-5');
  });

  it('runs a batch of items with mock mode', async () => {
    const items = [
      { id: 'batch-1', query: 'Thông số RTX 4060', relevant: ['product:252'], route: 'rag_only', history: [], category: 'model' },
      { id: 'batch-2', query: 'Xin chào', relevant: [], route: 'none', history: [], category: 'negative' },
    ];
    const run = await engine.run({ useRag: true, items, checkpoint: false });
    assert.equal(run.results.length, 2);
    assert.equal(run.mode, 'mock');
    assert.ok(run.metrics.geminiCalls > 0);
  });

  it('tracks metrics correctly', () => {
    const metrics = engine.metrics;
    assert.ok(metrics.geminiCalls > 0, 'Should count Gemini calls');
    assert.ok(metrics.embeddingCalls >= 0, 'Should track embedding calls');
    assert.equal(metrics.errors, 0, 'Should have no errors in mock mode');
  });

  it('handles multi-turn with history', async () => {
    const item = { id: 'test-mt', query: 'Nó có thông số thế nào?', relevant: ['product:253'], route: 'rag_only', history: [{ entities: ['RTX 4060 Ti'] }], category: 'multi_turn' };
    const result = await engine.evaluateItem(item, { useRag: true });
    assert.ok(result.rewrittenQuery);
  });
});
