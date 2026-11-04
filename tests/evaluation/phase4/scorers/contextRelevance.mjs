// Context Relevance Scorer
// Evaluates how relevant the retrieved chunks are to the user's query.
// Uses a hybrid approach: deterministic checks + LLM judge.

import { evalConfig } from '../config.mjs';

// Deterministic: what fraction of retrieved chunks belong to a relevant document?
export function deterministicContextRelevance(retrieved, relevantDocIds) {
  if (!retrieved?.length) return { score: null, reason: 'no_retrieval', details: [] };
  if (!relevantDocIds?.length) return { score: null, reason: 'no_labels', details: [] };

  const relevant = new Set(relevantDocIds);
  const details = retrieved.map(chunk => {
    const docId = chunk.metadata?.documentId || chunk.id?.split('::')[0] || chunk.id;
    const productId = chunk.metadata?.productId;
    const isRelevant = relevant.has(docId) || (productId && relevant.has(`product:${productId}`));
    return { chunkId: chunk.id, docId, productId, isRelevant, title: chunk.metadata?.title };
  });

  const relevantCount = details.filter(d => d.isRelevant).length;
  const precision = relevantCount / details.length;
  const uniqueRelevantFound = new Set(details.filter(d => d.isRelevant).map(d => d.docId?.split('::')[0] || d.docId));
  const recall = uniqueRelevantFound.size / relevant.size;

  return {
    score: precision,
    recall,
    precision,
    relevantChunks: relevantCount,
    totalChunks: details.length,
    reason: 'deterministic',
    details,
  };
}

const JUDGE_PROMPT = `You are evaluating the relevance of retrieved context documents to a user query for a Vietnamese computer hardware store chatbot.

Query: {query}

Retrieved context:
{context}

Score the overall relevance of the retrieved context on a scale of 0.0 to 1.0:
- 1.0: All chunks are directly relevant to the query topic and product
- 0.8: Most chunks relevant, minor irrelevant ones
- 0.6: Some relevant chunks mixed with clearly irrelevant ones
- 0.4: Few relevant chunks, mostly noise
- 0.2: Barely any relevance
- 0.0: Completely irrelevant context

For each chunk, state whether it is relevant (R) or irrelevant (I) and why in one sentence.

Respond in this exact JSON format (no markdown):
{"score": <number>, "chunkRatings": [{"index": 1, "rating": "R|I", "reason": "<brief reason>"}], "summary": "<one sentence>"}`;

export function buildContextRelevancePrompt(query, contextText) {
  return JUDGE_PROMPT
    .replace('{query}', query)
    .replace('{context}', contextText || '(no context retrieved)');
}

export function parseContextRelevanceResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const score = Math.max(0, Math.min(1, Number(parsed.score)));
    if (isNaN(score)) return { score: null, error: 'invalid_score', raw };
    return { score, chunkRatings: parsed.chunkRatings || [], summary: parsed.summary || '', raw };
  } catch {
    const match = raw.match(/["']?score["']?\s*:\s*([\d.]+)/);
    if (match) return { score: Math.max(0, Math.min(1, Number(match[1]))), summary: '', raw, partial: true };
    return { score: null, error: 'parse_failed', raw };
  }
}

export function combineContextRelevance(deterministic, llmJudge) {
  if (deterministic.score === null && llmJudge?.score === null) return { score: null, reason: 'not_applicable' };
  if (deterministic.score === null) return { ...llmJudge, method: 'llm_only' };
  if (!llmJudge || llmJudge.score === null) return { ...deterministic, method: 'deterministic_only' };
  // Weighted combination: 40% deterministic precision, 60% LLM judgment
  const combined = 0.4 * deterministic.score + 0.6 * llmJudge.score;
  return {
    score: Math.round(combined * 100) / 100,
    deterministicScore: deterministic.score,
    llmScore: llmJudge.score,
    precision: deterministic.precision,
    recall: deterministic.recall,
    method: 'combined',
    details: deterministic.details,
    chunkRatings: llmJudge.chunkRatings,
    summary: llmJudge.summary,
  };
}
