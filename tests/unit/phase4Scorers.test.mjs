import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicContextRelevance, buildContextRelevancePrompt,
  parseContextRelevanceResponse, combineContextRelevance,
} from '../evaluation/phase4/scorers/contextRelevance.mjs';
import {
  buildExtractClaimsPrompt, parseExtractClaimsResponse,
  buildVerifyClaimsPrompt, parseVerifyClaimsResponse,
  computeGroundednessScore, checkCitationSupport,
} from '../evaluation/phase4/scorers/groundedness.mjs';
import {
  buildAnswerRelevancePrompt, parseAnswerRelevanceResponse,
  checkProductMention, isValidNoContextResponse,
} from '../evaluation/phase4/scorers/answerRelevance.mjs';

// --- Context Relevance ---
describe('Context Relevance Scorer', () => {
  const makeChunk = (id, productId) => ({ id, metadata: { productId, title: `Product ${productId}` } });

  it('returns null score when no retrieval', () => {
    const r = deterministicContextRelevance([], ['product:1']);
    assert.equal(r.score, null);
    assert.equal(r.reason, 'no_retrieval');
  });

  it('returns null when no labels', () => {
    const r = deterministicContextRelevance([makeChunk('c1', 1)], []);
    assert.equal(r.score, null);
    assert.equal(r.reason, 'no_labels');
  });

  it('calculates perfect precision', () => {
    const chunks = [makeChunk('product:252::chunk-0', 252), makeChunk('product:252::chunk-1', 252)];
    const r = deterministicContextRelevance(chunks, ['product:252']);
    assert.equal(r.score, 1);
    assert.equal(r.precision, 1);
    assert.equal(r.recall, 1);
  });

  it('calculates mixed precision', () => {
    const chunks = [makeChunk('product:252::chunk-0', 252), makeChunk('product:999::chunk-0', 999)];
    const r = deterministicContextRelevance(chunks, ['product:252']);
    assert.equal(r.score, 0.5);
    assert.equal(r.relevantChunks, 1);
    assert.equal(r.totalChunks, 2);
  });

  it('recall accounts for multiple relevant docs', () => {
    const chunks = [makeChunk('product:252::chunk-0', 252)];
    const r = deterministicContextRelevance(chunks, ['product:252', 'product:253']);
    assert.equal(r.recall, 0.5);
  });

  it('parses valid JSON LLM response', () => {
    const raw = '{"score": 0.85, "chunkRatings": [{"index": 1, "rating": "R", "reason": "Relevant"}], "summary": "Good"}';
    const r = parseContextRelevanceResponse(raw);
    assert.equal(r.score, 0.85);
    assert.equal(r.summary, 'Good');
  });

  it('parses response with markdown fences', () => {
    const raw = '```json\n{"score": 0.7, "chunkRatings": [], "summary": "OK"}\n```';
    const r = parseContextRelevanceResponse(raw);
    assert.equal(r.score, 0.7);
  });

  it('handles garbage response with partial extraction', () => {
    const raw = 'The score is {"score": 0.6} for this context';
    const r = parseContextRelevanceResponse(raw);
    assert.equal(r.score, 0.6);
    assert.equal(r.partial, true);
  });

  it('returns null on total garbage', () => {
    const r = parseContextRelevanceResponse('I cannot evaluate this');
    assert.equal(r.score, null);
    assert.equal(r.error, 'parse_failed');
  });

  it('clamps score to [0, 1]', () => {
    assert.equal(parseContextRelevanceResponse('{"score": 1.5}').score, 1);
    assert.equal(parseContextRelevanceResponse('{"score": -0.3}').score, 0);
  });

  it('combines deterministic + LLM scores', () => {
    const det = { score: 1, precision: 1, recall: 1, details: [] };
    const llm = { score: 0.8, chunkRatings: [], summary: 'Good' };
    const combined = combineContextRelevance(det, llm);
    assert.equal(combined.method, 'combined');
    assert.equal(combined.score, 0.88); // 0.4*1 + 0.6*0.8
  });

  it('falls back to deterministic only', () => {
    const det = { score: 0.5, precision: 0.5, recall: 1, details: [] };
    const combined = combineContextRelevance(det, null);
    assert.equal(combined.method, 'deterministic_only');
    assert.equal(combined.score, 0.5);
  });

  it('builds prompt with query and context', () => {
    const prompt = buildContextRelevancePrompt('RTX 4060', 'Some context');
    assert.ok(prompt.includes('RTX 4060'));
    assert.ok(prompt.includes('Some context'));
  });
});

// --- Groundedness ---
describe('Groundedness Scorer', () => {
  it('parses valid claim extraction response', () => {
    const raw = '{"claims": [{"id": 1, "text": "RTX 4060 has 8GB GDDR6", "type": "spec"}]}';
    const r = parseExtractClaimsResponse(raw);
    assert.equal(r.claims.length, 1);
    assert.equal(r.claims[0].type, 'spec');
  });

  it('handles empty claims gracefully', () => {
    const raw = '{"claims": []}';
    const r = parseExtractClaimsResponse(raw);
    assert.equal(r.claims.length, 0);
  });

  it('handles parse failure', () => {
    const r = parseExtractClaimsResponse('not json');
    assert.equal(r.claims.length, 0);
    assert.equal(r.error, 'parse_failed');
  });

  it('parses valid verdict response', () => {
    const raw = '{"verdicts": [{"claimId": 1, "verdict": "supported", "score": 1, "evidence": "Source 1", "reason": "matches"}]}';
    const r = parseVerifyClaimsResponse(raw);
    assert.equal(r.verdicts.length, 1);
    assert.equal(r.verdicts[0].verdict, 'supported');
  });

  it('computes perfect groundedness', () => {
    const claims = [{ id: 1 }, { id: 2 }];
    const verdicts = [
      { claimId: 1, verdict: 'supported', score: 1 },
      { claimId: 2, verdict: 'supported', score: 1 },
    ];
    const r = computeGroundednessScore(claims, verdicts);
    assert.equal(r.score, 1);
    assert.equal(r.supported, 2);
    assert.equal(r.hallucinationRate, 0);
  });

  it('computes partial groundedness with contradiction', () => {
    const claims = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const verdicts = [
      { claimId: 1, verdict: 'supported', score: 1 },
      { claimId: 2, verdict: 'contradicted', score: 0 },
      { claimId: 3, verdict: 'unsupported', score: 0 },
    ];
    const r = computeGroundednessScore(claims, verdicts);
    assert.equal(r.score, 0.33);
    assert.equal(r.contradicted, 1);
    assert.equal(r.unsupported, 1);
    assert.ok(r.hallucinationRate > 0.6);
  });

  it('returns null for no claims', () => {
    const r = computeGroundednessScore([], []);
    assert.equal(r.score, null);
    assert.equal(r.reason, 'no_claims');
  });

  it('handles general knowledge claims', () => {
    const claims = [{ id: 1 }];
    const verdicts = [{ claimId: 1, verdict: 'general_knowledge', score: 0.5 }];
    const r = computeGroundednessScore(claims, verdicts);
    assert.equal(r.score, 0.5);
    assert.equal(r.generalKnowledge, 1);
  });

  it('checks citation support correctly', () => {
    const response = 'Theo [Nguồn 1] và [Nguồn 2], card này có 8GB.';
    const citations = [{ documentId: 'a' }, { documentId: 'b' }];
    const r = checkCitationSupport(response, citations);
    assert.equal(r.supported, 2);
    assert.equal(r.total, 2);
    assert.equal(r.rate, 1);
  });

  it('detects invalid citation reference', () => {
    const response = 'Theo [Nguồn 1] và [Nguồn 5]';
    const citations = [{ documentId: 'a' }, { documentId: 'b' }];
    const r = checkCitationSupport(response, citations);
    assert.equal(r.supported, 1);
    assert.equal(r.total, 2);
    assert.equal(r.rate, 0.5);
  });

  it('builds verification prompt with context and tool results', () => {
    const claims = [{ id: 1, text: 'RTX 4060 has 8GB', type: 'spec' }];
    const prompt = buildVerifyClaimsPrompt(claims, 'RAG context here', [{ name: 'search_products', result: { items: [] } }]);
    assert.ok(prompt.includes('RAG context here'));
    assert.ok(prompt.includes('search_products'));
    assert.ok(prompt.includes('RTX 4060 has 8GB'));
  });
});

// --- Answer Relevance ---
describe('Answer Relevance Scorer', () => {
  it('parses valid answer relevance response', () => {
    const raw = '{"score": 0.9, "correctProduct": true, "completeness": "high", "issues": [], "summary": "Good answer"}';
    const r = parseAnswerRelevanceResponse(raw);
    assert.equal(r.score, 0.9);
    assert.equal(r.correctProduct, true);
    assert.equal(r.completeness, 'high');
  });

  it('handles partial parse', () => {
    const r = parseAnswerRelevanceResponse('The score: 0.75 is my assessment.');
    assert.equal(r.score, 0.75);
    assert.equal(r.partial, true);
  });

  it('handles total garbage', () => {
    const r = parseAnswerRelevanceResponse('cannot evaluate');
    assert.equal(r.score, null);
  });

  it('checks product mention correctly', () => {
    const response = 'Card màn hình ASUS DUAL GeForce RTX 4060 có công suất 115W và bộ nhớ 8GB GDDR6.';
    const chunks = [{ id: 'product:252::chunk-0', metadata: { productId: 252, title: 'Card màn hình ASUS DUAL GeForce RTX 4060 OC 8GB GDDR6' } }];
    const r = checkProductMention(response, ['product:252'], chunks);
    assert.equal(r.mentioned, true);
  });

  it('returns null mention when no labels', () => {
    const r = checkProductMention('some response', [], []);
    assert.equal(r.mentioned, null);
  });

  it('validates no-context negative response', () => {
    assert.equal(isValidNoContextResponse('Xin lỗi, mình chỉ hỗ trợ về sản phẩm máy tính.', 'negative'), true);
    assert.equal(isValidNoContextResponse('Thông số RTX 4060 là...', 'negative'), false);
  });

  it('validates missing data response', () => {
    assert.equal(isValidNoContextResponse('Mình không tìm thấy sản phẩm RTX 9999 trong hệ thống.', 'missing'), true);
  });

  it('builds prompt with history', () => {
    const prompt = buildAnswerRelevancePrompt('Nó có thông số gì?', 'Thông số RTX 4060...', [{ entities: ['RTX 4060'] }]);
    assert.ok(prompt.includes('RTX 4060'));
    assert.ok(prompt.includes('Conversation history'));
  });

  it('builds prompt without history', () => {
    const prompt = buildAnswerRelevancePrompt('RTX 4060 thông số', 'Response here', []);
    assert.ok(!prompt.includes('Conversation history'));
  });
});
