/**
 * RAG Triad Evaluation Module
 *
 * Đánh giá chất lượng hệ thống RAG theo 3 tiêu chí (RAG Triad):
 *   1. Context Relevance — Context retrieved có liên quan đến câu hỏi?
 *   2. Groundedness (Faithfulness) — Câu trả lời có dựa trên context?
 *   3. Answer Relevance — Câu trả lời có đúng câu hỏi người dùng?
 *
 * Sử dụng LLM-as-Judge (Anthropic Claude) để chấm điểm 1-5 cho mỗi tiêu chí.
 */

import { aiConfig } from '../../config/ai.config.js';

const JUDGE_PROMPTS = {
  contextRelevance: (query, context) => ({
    system: `Bạn là evaluator chuyên đánh giá hệ thống RAG. Chấm điểm context relevance từ 1-5.

Tiêu chí CONTEXT RELEVANCE: Context (tài liệu tham khảo) được retrieve có liên quan đến câu hỏi của người dùng không?

Thang điểm:
1 — Hoàn toàn không liên quan, context nói về chủ đề khác
2 — Liên quan rất ít, chỉ có vài từ khóa chung
3 — Liên quan một phần, có thông tin hữu ích nhưng thiếu nhiều
4 — Liên quan tốt, đủ thông tin để trả lời phần lớn câu hỏi
5 — Rất liên quan, context chứa đầy đủ thông tin cần thiết

Trả lời ĐÚNG format JSON:
{"score": <1-5>, "reason": "<lý do ngắn gọn>"}`,
    user: `Câu hỏi: ${query}\n\nContext retrieved:\n${context || '(không có context)'}`,
  }),

  groundedness: (query, context, answer) => ({
    system: `Bạn là evaluator chuyên đánh giá hệ thống RAG. Chấm điểm groundedness (faithfulness) từ 1-5.

Tiêu chí GROUNDEDNESS: Câu trả lời của AI có dựa trên thông tin trong context không? Có bịa thông tin không?

Thang điểm:
1 — Hoàn toàn bịa, không có gì trong context hỗ trợ
2 — Phần lớn bịa, chỉ 1-2 chi tiết đúng
3 — Nửa đúng nửa bịa, có thêm thông tin ngoài context
4 — Phần lớn dựa trên context, chỉ có ít suy luận thêm hợp lý
5 — Hoàn toàn dựa trên context và tool results, không bịa

Lưu ý: Nếu câu trả lời dùng dữ liệu từ tool call (search_products, lookup_my_orders) thì đó cũng là grounded.
Nếu không có context (câu hỏi ngoài domain), AI từ chối trả lời = grounded (điểm 5).

Trả lời ĐÚNG format JSON:
{"score": <1-5>, "reason": "<lý do ngắn gọn>"}`,
    user: `Câu hỏi: ${query}\n\nContext:\n${context || '(không có context)'}\n\nCâu trả lời AI:\n${answer}`,
  }),

  answerRelevance: (query, answer) => ({
    system: `Bạn là evaluator chuyên đánh giá hệ thống RAG. Chấm điểm answer relevance từ 1-5.

Tiêu chí ANSWER RELEVANCE: Câu trả lời có đúng câu hỏi người dùng đặt ra không?

Thang điểm:
1 — Hoàn toàn lệch đề, trả lời chủ đề khác
2 — Liên quan ít, trả lời chung chung không đúng trọng tâm
3 — Đúng chủ đề nhưng thiếu thông tin quan trọng hoặc lan man
4 — Đúng và đầy đủ phần lớn, có thể thiếu 1-2 chi tiết nhỏ
5 — Trả lời chính xác, đầy đủ, đúng trọng tâm câu hỏi

Lưu ý: Câu hỏi ngoài domain (thời tiết, nấu ăn...) mà AI từ chối lịch sự = answer relevance 5.

Trả lời ĐÚNG format JSON:
{"score": <1-5>, "reason": "<lý do ngắn gọn>"}`,
    user: `Câu hỏi: ${query}\n\nCâu trả lời AI:\n${answer}`,
  }),
};

async function judgeWithLLM(provider, promptConfig) {
  try {
    const result = await provider.complete({
      messages: [
        { role: 'system', content: promptConfig.system },
        { role: 'user', content: promptConfig.user },
      ],
      maxTokens: 200,
    });
    const text = result.content || '';
    const jsonMatch = text.match(/\{[\s\S]*"score"\s*:[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.score >= 1 && parsed.score <= 5) return { score: parsed.score, reason: parsed.reason || '' };
      } catch { /* fall through to regex */ }
    }
    const scoreMatch = text.match(/"score"\s*:\s*(\d)/) || text.match(/(\d)\s*\/?\s*5/);
    return { score: scoreMatch ? parseInt(scoreMatch[1], 10) : 3, reason: text.slice(0, 200) };
  } catch (err) {
    return { score: 0, reason: `LLM judge error: ${err.message}` };
  }
}

/**
 * Đánh giá 1 test case theo RAG Triad.
 *
 * @param {object} provider — AI provider instance (dùng cho LLM-as-judge)
 * @param {object} params
 * @param {string} params.query — Câu hỏi người dùng
 * @param {string} params.context — Context đã retrieve (raw text)
 * @param {string} params.answer — Câu trả lời của AI
 * @param {Array} params.toolCalls — Tool calls đã thực hiện
 * @returns {{ contextRelevance, groundedness, answerRelevance, overall }}
 */
export async function evaluateTriad(provider, { query, context, answer, toolCalls = [] }) {
  const toolInfo = toolCalls.length
    ? '\n\nTool calls đã thực hiện:\n' + toolCalls.map(tc => `- ${tc.name}: ${JSON.stringify(tc.result?.items?.length ?? tc.result).slice(0, 200)}`).join('\n')
    : '';

  const [contextRelevance, groundedness, answerRelevance] = await Promise.all([
    judgeWithLLM(provider, JUDGE_PROMPTS.contextRelevance(query, context)),
    judgeWithLLM(provider, JUDGE_PROMPTS.groundedness(query, context + toolInfo, answer)),
    judgeWithLLM(provider, JUDGE_PROMPTS.answerRelevance(query, answer)),
  ]);

  const scores = [contextRelevance.score, groundedness.score, answerRelevance.score].filter(s => s > 0);
  const overall = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;

  return {
    contextRelevance,
    groundedness,
    answerRelevance,
    overall,
  };
}

/**
 * Chạy evaluation trên danh sách kết quả đã thu thập.
 *
 * @param {object} provider — AI provider
 * @param {Array<{id, query, context, answer, toolCalls, category}>} results
 * @returns {object} Report tổng hợp
 */
export async function evaluateBatch(provider, results) {
  const evaluations = [];
  for (const result of results) {
    const triad = await evaluateTriad(provider, result);
    evaluations.push({
      id: result.id,
      query: result.query,
      category: result.category,
      triad,
    });
    console.log(`[RAG Triad] ${result.id}: CR=${triad.contextRelevance.score} G=${triad.groundedness.score} AR=${triad.answerRelevance.score} → ${triad.overall}`);
  }

  const byCategory = {};
  for (const ev of evaluations) {
    if (!byCategory[ev.category]) byCategory[ev.category] = [];
    byCategory[ev.category].push(ev.triad);
  }

  const avgScore = (list, key) => {
    const scores = list.map(t => t[key].score).filter(s => s > 0);
    return scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;
  };

  const summary = {
    totalCases: evaluations.length,
    overall: {
      contextRelevance: avgScore(evaluations.map(e => e.triad), 'contextRelevance'),
      groundedness: avgScore(evaluations.map(e => e.triad), 'groundedness'),
      answerRelevance: avgScore(evaluations.map(e => e.triad), 'answerRelevance'),
      average: +(evaluations.reduce((s, e) => s + e.triad.overall, 0) / evaluations.length).toFixed(2),
    },
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, triads]) => [cat, {
        count: triads.length,
        contextRelevance: avgScore(triads, 'contextRelevance'),
        groundedness: avgScore(triads, 'groundedness'),
        answerRelevance: avgScore(triads, 'answerRelevance'),
      }])
    ),
    evaluations,
    timestamp: new Date().toISOString(),
  };

  return summary;
}

/**
 * Format report thành text đọc được.
 */
export function formatReport(summary) {
  const lines = [
    '═══════════════════════════════════════════════════',
    '       RAG TRIAD EVALUATION REPORT — DUCMANH PC',
    '═══════════════════════════════════════════════════',
    `Thời gian: ${summary.timestamp}`,
    `Tổng test cases: ${summary.totalCases}`,
    '',
    '── TỔNG QUAN ──────────────────────────────────────',
    `  Context Relevance:  ${summary.overall.contextRelevance}/5`,
    `  Groundedness:       ${summary.overall.groundedness}/5`,
    `  Answer Relevance:   ${summary.overall.answerRelevance}/5`,
    `  ─────────────────────────────────`,
    `  TRUNG BÌNH:         ${summary.overall.average}/5`,
    '',
    '── THEO LOẠI CÂU HỎI ─────────────────────────────',
  ];

  for (const [cat, data] of Object.entries(summary.byCategory)) {
    lines.push(`  ${cat} (${data.count} cases):`);
    lines.push(`    CR=${data.contextRelevance}  G=${data.groundedness}  AR=${data.answerRelevance}`);
  }

  lines.push('', '── CHI TIẾT ───────────────────────────────────────');
  for (const ev of summary.evaluations) {
    const t = ev.triad;
    lines.push(`  [${ev.id}] ${ev.query.slice(0, 50)}`);
    lines.push(`    CR=${t.contextRelevance.score} (${t.contextRelevance.reason})`);
    lines.push(`    G=${t.groundedness.score} (${t.groundedness.reason})`);
    lines.push(`    AR=${t.answerRelevance.score} (${t.answerRelevance.reason})`);
    lines.push(`    Overall: ${t.overall}/5`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');
  const avg = summary.overall.average;
  if (avg >= 4) lines.push('✔ Hệ thống RAG đạt chất lượng TỐT (≥4/5)');
  else if (avg >= 3) lines.push('⚠ Hệ thống RAG đạt chất lượng TRUNG BÌNH (3-4/5) — cần cải thiện');
  else lines.push('✘ Hệ thống RAG chất lượng THẤP (<3/5) — cần xem lại kiến trúc');

  return lines.join('\n');
}
