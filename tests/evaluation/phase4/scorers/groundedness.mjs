// Groundedness / Faithfulness Scorer
// Evaluates whether claims in the AI response are supported by source data.
// Step 1: Extract claims from the response.
// Step 2: Verify each claim against the context + tool results.

const EXTRACT_PROMPT = `You are analyzing an AI chatbot response about computer hardware products in a Vietnamese store.

User query: {query}
AI response: {response}

Extract all factual claims from the response. A claim is any specific assertion about:
- Product specifications (TDP, memory, clock speed, dimensions, etc.)
- Product identity (name, brand, SKU, category)
- Pricing or stock (only if mentioned)
- Policy details (warranty period, return conditions, etc.)
- Comparisons between products
- Recommendations or conclusions based on data

Do NOT extract:
- Greetings, pleasantries, or filler text
- Questions the AI asks back
- Hedging language ("có thể", "tùy nhu cầu")

Respond in this exact JSON format (no markdown):
{"claims": [{"id": 1, "text": "<the claim in Vietnamese>", "type": "spec|identity|price|policy|comparison|recommendation"}]}`;

const VERIFY_PROMPT = `You are a fact-checker for a Vietnamese computer hardware store chatbot. Verify each claim against the provided evidence.

Claims to verify:
{claims}

Evidence sources:
{evidence}

For each claim, determine:
- "supported": Claim is directly confirmed by the evidence
- "unsupported": Claim has no evidence for or against (information not in sources)
- "contradicted": Evidence directly contradicts the claim
- "general_knowledge": Claim is widely known general tech knowledge, not store-specific

Score each claim 1 (fully supported), 0.5 (partially supported or general knowledge), 0 (unsupported or contradicted).

Respond in this exact JSON format (no markdown):
{"verdicts": [{"claimId": 1, "verdict": "supported|unsupported|contradicted|general_knowledge", "score": <0|0.5|1>, "evidence": "<which source or tool result supports/contradicts>", "reason": "<brief explanation>"}]}`;

export function buildExtractClaimsPrompt(query, response) {
  return EXTRACT_PROMPT
    .replace('{query}', query)
    .replace('{response}', response);
}

export function parseExtractClaimsResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.claims)) return { claims: parsed.claims };
    if (Array.isArray(parsed)) return { claims: parsed };
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0 && parsed[key][0].text !== undefined) {
        return { claims: parsed[key] };
      }
    }
    return { claims: [], error: 'no_claims_array', raw };
  } catch {
    return { claims: [], error: 'parse_failed', raw };
  }
}

export function buildVerifyClaimsPrompt(claims, contextText, toolResults) {
  const claimsText = claims.map(c => `[${c.id}] ${c.text} (${c.type})`).join('\n');
  let evidence = '';
  if (contextText) evidence += `RAG Context:\n${contextText}\n\n`;
  if (toolResults?.length) {
    evidence += 'Tool Results:\n';
    for (const tc of toolResults) {
      evidence += `[${tc.name}]: ${JSON.stringify(tc.result).slice(0, 1500)}\n`;
    }
  }
  if (!evidence.trim()) evidence = '(no evidence sources available)';

  return VERIFY_PROMPT
    .replace('{claims}', claimsText)
    .replace('{evidence}', evidence);
}

export function parseVerifyClaimsResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.verdicts)) return { verdicts: parsed.verdicts };
    if (Array.isArray(parsed)) return { verdicts: parsed };
    // Some models return verdicts under different keys
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0 && parsed[key][0].claimId !== undefined) {
        return { verdicts: parsed[key] };
      }
    }
    return { verdicts: [], error: 'no_verdicts_array', raw };
  } catch {
    // Try to extract individual verdict objects with regex
    const verdicts = [];
    const pattern = /"claimId"\s*:\s*(\d+)\s*,\s*"verdict"\s*:\s*"(\w+)"\s*,\s*"score"\s*:\s*([\d.]+)/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      verdicts.push({ claimId: parseInt(match[1]), verdict: match[2], score: parseFloat(match[3]) });
    }
    if (verdicts.length > 0) return { verdicts, partial: true };
    return { verdicts: [], error: 'parse_failed', raw };
  }
}

export function computeGroundednessScore(claims, verdicts) {
  if (!claims.length) return { score: null, reason: 'no_claims', claimCount: 0 };
  if (!verdicts.length) return { score: null, reason: 'no_verdicts', claimCount: claims.length };

  const verdictMap = new Map(verdicts.map(v => [v.claimId, v]));
  let totalScore = 0;
  let scoredCount = 0;
  const details = [];

  for (const claim of claims) {
    const v = verdictMap.get(claim.id);
    if (!v) {
      details.push({ ...claim, verdict: 'missing', score: 0 });
      continue;
    }
    const s = Math.max(0, Math.min(1, Number(v.score) || 0));
    totalScore += s;
    scoredCount++;
    details.push({ ...claim, verdict: v.verdict, score: s, evidence: v.evidence, reason: v.reason });
  }

  const supported = details.filter(d => d.verdict === 'supported').length;
  const contradicted = details.filter(d => d.verdict === 'contradicted').length;
  const unsupported = details.filter(d => d.verdict === 'unsupported').length;

  return {
    score: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 100) / 100 : 0,
    claimCount: claims.length,
    supported,
    contradicted,
    unsupported,
    generalKnowledge: details.filter(d => d.verdict === 'general_knowledge').length,
    hallucinationRate: claims.length > 0 ? Math.round(((contradicted + unsupported) / claims.length) * 100) / 100 : 0,
    details,
  };
}

// Deterministic check: do citations in the response actually match context?
export function checkCitationSupport(response, citations) {
  if (!response || !citations?.length) return { supported: 0, total: 0, rate: null };
  const citationRefs = (response.match(/\[Nguồn \d+\]/g) || []);
  const total = citationRefs.length;
  const maxSource = citations.length;
  const supported = citationRefs.filter(ref => {
    const num = parseInt(ref.match(/\d+/)[0]);
    return num >= 1 && num <= maxSource;
  }).length;
  return { supported, total, rate: total > 0 ? supported / total : null };
}
