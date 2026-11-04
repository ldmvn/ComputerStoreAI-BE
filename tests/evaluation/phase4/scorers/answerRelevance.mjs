// Answer Relevance Scorer
// Evaluates whether the AI response addresses the user's question correctly.

const JUDGE_PROMPT = `You are evaluating an AI chatbot response for a Vietnamese computer hardware store.

User query: {query}
{history_section}
AI response: {response}

Evaluate the response on these criteria:
1. Does it address the correct product(s) mentioned in the query?
2. Does it answer what was actually asked (specs, price, comparison, policy, etc.)?
3. Is it complete enough to be useful?
4. Does it avoid unnecessary tangents or irrelevant information?
5. For multi-turn: does it correctly use conversation context?
6. For missing data: does it acknowledge gaps honestly instead of fabricating?

Score from 0.0 to 1.0:
- 1.0: Perfectly addresses the query with correct product, complete information
- 0.8: Mostly correct and complete, minor gaps
- 0.6: Addresses the right topic but incomplete or slightly off-target
- 0.4: Partially relevant but misses key aspects or wrong product
- 0.2: Barely relevant, mostly off-topic or wrong product
- 0.0: Completely irrelevant, refuses valid query, or answers wrong question

Respond in this exact JSON format (no markdown):
{"score": <number>, "correctProduct": <true|false|null>, "completeness": "<high|medium|low>", "issues": ["<issue1>", "<issue2>"], "summary": "<one sentence assessment>"}`;

export function buildAnswerRelevancePrompt(query, response, history) {
  let historySection = '';
  if (history?.length) {
    historySection = 'Conversation history (previous entities): ' +
      history.map(h => JSON.stringify(h.entities || [])).join(', ') + '\n';
  }
  return JUDGE_PROMPT
    .replace('{query}', query)
    .replace('{history_section}', historySection)
    .replace('{response}', response || '(no response)');
}

export function parseAnswerRelevanceResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const score = Math.max(0, Math.min(1, Number(parsed.score)));
    if (isNaN(score)) return { score: null, error: 'invalid_score', raw };
    return {
      score,
      correctProduct: parsed.correctProduct ?? null,
      completeness: parsed.completeness || 'unknown',
      issues: parsed.issues || [],
      summary: parsed.summary || '',
      raw,
    };
  } catch {
    const match = raw.match(/["']?score["']?\s*:\s*([\d.]+)/);
    if (match) return { score: Math.max(0, Math.min(1, Number(match[1]))), summary: '', raw, partial: true };
    return { score: null, error: 'parse_failed', raw };
  }
}

// Deterministic: does the response mention the expected product?
export function checkProductMention(response, relevantDocs, contextChunks) {
  if (!response || !relevantDocs?.length) return { mentioned: null, reason: 'no_labels' };
  const lower = response.toLowerCase();
  const productNames = [];
  for (const chunk of contextChunks || []) {
    if (relevantDocs.some(id => {
      const docId = chunk.metadata?.documentId || chunk.id?.split('::')[0];
      return id === docId || id === `product:${chunk.metadata?.productId}`;
    })) {
      if (chunk.metadata?.title) productNames.push(chunk.metadata.title.toLowerCase());
      if (chunk.metadata?.sourceRef) productNames.push(chunk.metadata.sourceRef.toLowerCase());
    }
  }
  if (!productNames.length) return { mentioned: null, reason: 'no_product_names' };
  const mentioned = productNames.some(name => {
    const words = name.split(/\s+/).filter(w => w.length > 3);
    return words.filter(w => lower.includes(w)).length >= Math.min(2, words.length);
  });
  return { mentioned, productNames };
}

// For baseline (no RAG): special handling
export function isValidNoContextResponse(response, category) {
  if (!response) return false;
  if (category === 'negative') {
    // Should decline gracefully or redirect
    return !/thông số|công suất|bộ nhớ|chip/i.test(response);
  }
  if (category === 'missing') {
    // Should acknowledge missing data
    return /không có|chưa có|không tìm|thiếu/i.test(response) || response.length < 200;
  }
  return true;
}
