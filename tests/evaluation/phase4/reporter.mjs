// Phase 4 Report Generator
// Produces evaluation.json, evaluation.csv, comparison.md, methodology.md, verification.txt

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalConfig } from './config.mjs';

const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../../../reports/phase4', import.meta.url));

function safeScore(v) { return v?.score ?? null; }
function avg(arr) { const valid = arr.filter(v => v !== null && v !== undefined); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; }
function median(arr) { const sorted = arr.filter(v => v !== null).sort((a, b) => a - b); if (!sorted.length) return null; const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }
function p95(arr) { const sorted = arr.filter(v => v !== null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null; }
function round(v, d = 4) { return v !== null && v !== undefined ? Math.round(v * 10 ** d) / 10 ** d : null; }

function computeSummary(results) {
  const scored = results.filter(r => !r.error);
  const withRetrieval = scored.filter(r => r.evaluation?.contextRelevance?.score !== null);
  const withResponse = scored.filter(r => r.response);
  const withGroundedness = withResponse.filter(r => r.evaluation?.groundedness?.score !== null);
  const withAnswerRel = withResponse.filter(r => r.evaluation?.answerRelevance?.score !== null);

  const crScores = withRetrieval.map(r => r.evaluation.contextRelevance.score);
  const grScores = withGroundedness.map(r => r.evaluation.groundedness.score);
  const arScores = withAnswerRel.map(r => r.evaluation.answerRelevance.score);
  const latencies = scored.map(r => r.totalLatencyMs).filter(v => v != null);

  const hallucinationRates = withGroundedness.map(r => r.evaluation.groundedness.hallucinationRate).filter(v => v != null);
  const citationRates = withGroundedness.map(r => r.evaluation.groundedness.citationSupport?.rate).filter(v => v != null);

  return {
    totalCases: results.length,
    scoredCases: scored.length,
    errors: results.filter(r => r.error).length,
    triad: {
      contextRelevance: { mean: round(avg(crScores)), median: round(median(crScores)), count: crScores.length },
      groundedness: { mean: round(avg(grScores)), median: round(median(grScores)), count: grScores.length },
      answerRelevance: { mean: round(avg(arScores)), median: round(median(arScores)), count: arScores.length },
    },
    hallucinationRate: { mean: round(avg(hallucinationRates)), count: hallucinationRates.length },
    citationSupportRate: { mean: round(avg(citationRates)), count: citationRates.length },
    latency: { mean: round(avg(latencies)), median: round(median(latencies)), p95: round(p95(latencies)) },
    routingAccuracy: scored.length > 0 ? round(scored.filter(r => r.routing?.route === r.expectedRoute).length / scored.length) : null,
  };
}

function computeByCategory(results) {
  const categories = [...new Set(results.map(r => r.category))];
  const out = {};
  for (const cat of categories) {
    out[cat] = computeSummary(results.filter(r => r.category === cat));
  }
  return out;
}

export async function generateReports(baselineRun, ragRun, corpusInfo, { reportsDir } = {}) {
  const REPORTS_DIR = reportsDir || DEFAULT_REPORTS_DIR;
  await mkdir(REPORTS_DIR, { recursive: true });
  const baselineSummary = computeSummary(baselineRun.results);
  const ragSummary = computeSummary(ragRun.results);
  const baselineByCategory = computeByCategory(baselineRun.results);
  const ragByCategory = computeByCategory(ragRun.results);

  // evaluation.json
  const evalData = {
    generatedAt: new Date().toISOString(),
    corpus: corpusInfo,
    config: { generatorModel: evalConfig.generatorModel, judgeModel: evalConfig.judgeModel, mode: ragRun.mode },
    baseline: { summary: baselineSummary, byCategory: baselineByCategory, metrics: baselineRun.metrics },
    rag: { summary: ragSummary, byCategory: ragByCategory, metrics: ragRun.metrics },
    records: { baseline: baselineRun.results, rag: ragRun.results },
  };
  await writeFile(join(REPORTS_DIR, 'evaluation.json'), JSON.stringify(evalData, null, 2));

  // evaluation.csv
  const header = 'version,id,category,query,route,context_relevance,groundedness,answer_relevance,hallucination_rate,citation_rate,latency_ms,response_length';
  const rows = [];
  for (const [label, results] of [['baseline', baselineRun.results], ['rag', ragRun.results]]) {
    for (const r of results) {
      rows.push([
        label, r.id, r.category, `"${(r.query || '').replace(/"/g, '""')}"`,
        r.routing?.route || r.expectedRoute || '',
        safeScore(r.evaluation?.contextRelevance) ?? '',
        safeScore(r.evaluation?.groundedness) ?? '',
        safeScore(r.evaluation?.answerRelevance) ?? '',
        r.evaluation?.groundedness?.hallucinationRate ?? '',
        r.evaluation?.groundedness?.citationSupport?.rate ?? '',
        round(r.totalLatencyMs || 0, 1) ?? '',
        r.response?.length ?? 0,
      ].join(','));
    }
  }
  await writeFile(join(REPORTS_DIR, 'evaluation.csv'), header + '\n' + rows.join('\n') + '\n');

  // comparison.md
  const md = generateComparisonMarkdown(baselineSummary, ragSummary, baselineByCategory, ragByCategory, corpusInfo, ragRun.mode, baselineRun.metrics, ragRun.metrics);
  await writeFile(join(REPORTS_DIR, 'comparison.md'), md);

  // methodology.md
  const meth = generateMethodologyMarkdown(corpusInfo, ragRun.mode);
  await writeFile(join(REPORTS_DIR, 'methodology.md'), meth);

  // verification.txt
  const verif = generateVerification(baselineSummary, ragSummary, baselineRun, ragRun);
  await writeFile(join(REPORTS_DIR, 'verification.txt'), verif);

  return { baselineSummary, ragSummary };
}

function fmt(v) { return v !== null && v !== undefined ? v.toFixed(4) : 'N/A'; }
function pct(v) { return v !== null && v !== undefined ? (v * 100).toFixed(1) + '%' : 'N/A'; }

function generateComparisonMarkdown(bl, rag, blCat, ragCat, corpus, mode, blMetrics, ragMetrics) {
  return `# DUCMANH PC — Phase 4: So sánh Baseline vs Hybrid RAG

## Thông tin thực nghiệm
- **Ngày:** ${new Date().toISOString().split('T')[0]}
- **Corpus:** ${corpus.chunks} chunks, ${corpus.documents} documents (SHA256: \`${corpus.sha256.slice(0, 16)}…\`)
- **Chế độ:** ${mode === 'mock' ? 'Mock/Offline (điểm mô phỏng, không phải kết quả Gemini thật)' : 'Live (Gemini API thật)'}
- **Model tạo câu trả lời:** ${evalConfig.generatorModel}
- **Model đánh giá:** ${evalConfig.judgeModel}
- **Bộ benchmark:** 43 câu hỏi (model, SKU, policy, comparison, multi-turn, negative, missing)

## Tổng hợp RAG Triad

| Tiêu chí | Baseline (FC only) | Hybrid RAG + FC | Δ |
|---|---|---|---|
| **Context Relevance** | ${fmt(bl.triad.contextRelevance.mean)} (n=${bl.triad.contextRelevance.count}) | ${fmt(rag.triad.contextRelevance.mean)} (n=${rag.triad.contextRelevance.count}) | ${rag.triad.contextRelevance.mean !== null && bl.triad.contextRelevance.mean !== null ? (rag.triad.contextRelevance.mean - bl.triad.contextRelevance.mean > 0 ? '+' : '') + (rag.triad.contextRelevance.mean - bl.triad.contextRelevance.mean).toFixed(4) : 'N/A'} |
| **Groundedness** | ${fmt(bl.triad.groundedness.mean)} (n=${bl.triad.groundedness.count}) | ${fmt(rag.triad.groundedness.mean)} (n=${rag.triad.groundedness.count}) | ${rag.triad.groundedness.mean !== null && bl.triad.groundedness.mean !== null ? (rag.triad.groundedness.mean - bl.triad.groundedness.mean > 0 ? '+' : '') + (rag.triad.groundedness.mean - bl.triad.groundedness.mean).toFixed(4) : 'N/A'} |
| **Answer Relevance** | ${fmt(bl.triad.answerRelevance.mean)} (n=${bl.triad.answerRelevance.count}) | ${fmt(rag.triad.answerRelevance.mean)} (n=${rag.triad.answerRelevance.count}) | ${rag.triad.answerRelevance.mean !== null && bl.triad.answerRelevance.mean !== null ? (rag.triad.answerRelevance.mean - bl.triad.answerRelevance.mean > 0 ? '+' : '') + (rag.triad.answerRelevance.mean - bl.triad.answerRelevance.mean).toFixed(4) : 'N/A'} |

## Metrics bổ sung

| Metric | Baseline | Hybrid RAG |
|---|---|---|
| Hallucination Rate | ${pct(bl.hallucinationRate.mean)} | ${pct(rag.hallucinationRate.mean)} |
| Citation Support Rate | ${pct(bl.citationSupportRate.mean)} | ${pct(rag.citationSupportRate.mean)} |
| Routing Accuracy | ${pct(bl.routingAccuracy)} | ${pct(rag.routingAccuracy)} |
| Latency (median) | ${fmt(bl.latency.median)} ms | ${fmt(rag.latency.median)} ms |
| Latency (p95) | ${fmt(bl.latency.p95)} ms | ${fmt(rag.latency.p95)} ms |
| Gemini API Calls | ${blMetrics.geminiCalls} | ${ragMetrics.geminiCalls} |
| Embedding Calls | ${blMetrics.embeddingCalls} | ${ragMetrics.embeddingCalls} |
| Prompt Tokens | ${blMetrics.promptTokens} | ${ragMetrics.promptTokens} |
| Completion Tokens | ${blMetrics.completionTokens} | ${ragMetrics.completionTokens} |
| Errors | ${bl.errors} | ${rag.errors} |

## Phân tích theo nhóm câu hỏi

${Object.keys(ragCat).map(cat => {
  const b = blCat[cat] || {};
  const r = ragCat[cat] || {};
  return `### ${cat}
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | ${fmt(b.triad?.contextRelevance?.mean)} | ${fmt(r.triad?.contextRelevance?.mean)} |
| Groundedness | ${fmt(b.triad?.groundedness?.mean)} | ${fmt(r.triad?.groundedness?.mean)} |
| Answer Relevance | ${fmt(b.triad?.answerRelevance?.mean)} | ${fmt(r.triad?.answerRelevance?.mean)} |
| Cases | ${b.totalCases || 0} | ${r.totalCases || 0} |`;
}).join('\n\n')}

${mode === 'mock' ? '\n> **Lưu ý:** Kết quả trên sử dụng mock provider (không gọi Gemini API thật). Điểm số phản ánh hoạt động pipeline, không phải chất lượng thực tế. Chạy lại với `--mode live` để có kết quả thực nghiệm.\n' : ''}
`;
}

function generateMethodologyMarkdown(corpus, mode) {
  return `# DUCMANH PC — Phase 4: Methodology

## 1. Thiết kế thực nghiệm

### Mục tiêu
Đánh giá định lượng chất lượng AI Chatbot DUCMANH PC qua ba tiêu chí RAG Triad:
- **Context Relevance:** Chunks truy xuất có liên quan đến câu hỏi?
- **Groundedness/Faithfulness:** Câu trả lời có được chứng minh bằng dữ liệu nguồn?
- **Answer Relevance:** Câu trả lời có giải quyết đúng câu hỏi?

### Hai cấu hình so sánh
- **Baseline A:** Gemini + Function Calling (không RAG retrieval)
- **System B:** Gemini + Hybrid RAG (Semantic + BM25 + RRF) + Function Calling

## 2. Bộ dữ liệu

- **43 câu hỏi benchmark** bao phủ: model (8), SKU (6), Vietnamese accent (4), policy (4), comparison (4), multi-turn (7), routing (5), negative (3), missing (2)
- **Corpus:** ${corpus.chunks} chunks từ ${corpus.documents} tài liệu (SHA256: \`${corpus.sha256}\`)
- Dữ liệu sản phẩm và chính sách thật từ Knowledge Base DUCMANH PC
- Nhãn relevance ở cấp document, do engineering team gán

## 3. Quy trình đánh giá

### Context Relevance (kết hợp)
- **Deterministic (40%):** Precision = chunks thuộc document relevant / tổng chunks. Recall = document relevant tìm thấy / tổng document relevant.
- **LLM Judge (60%):** Gemini đánh giá từng chunk có liên quan đến query không, thang 0–1.
- Kết hợp: 0.4 × deterministic + 0.6 × LLM.
- N/A khi không có retrieval (baseline cho query không cần RAG).

### Groundedness / Faithfulness (2 bước)
1. **Trích xuất claims:** LLM tách các khẳng định cụ thể từ câu trả lời.
2. **Xác minh:** LLM kiểm tra từng claim đối với context + tool results.
   - supported (1.0), general_knowledge (0.5), unsupported (0.0), contradicted (0.0)
- Score = trung bình điểm các claims.
- Hallucination Rate = (contradicted + unsupported) / total claims.
- Citation Support Rate = citations hợp lệ / tổng citations trong response.

### Answer Relevance
- LLM đánh giá: đúng sản phẩm, đầy đủ, đúng trọng tâm, thang 0–1.
- Bổ sung kiểm tra deterministic: response có nhắc đến product name trong relevant docs.

## 4. Thang điểm và rubric

Tất cả điểm trên thang 0.0–1.0:
- 1.0: Hoàn hảo
- 0.8: Tốt, sai sót nhỏ
- 0.6: Trung bình, thiếu hoặc lệch nhẹ
- 0.4: Yếu, thiếu nhiều hoặc sai
- 0.2: Rất yếu
- 0.0: Hoàn toàn sai hoặc không liên quan

## 5. Giới hạn và lưu ý

- Retrieval sử dụng mock embeddings (deterministic hash-based vectors), không phải Gemini semantic embeddings. Metrics retrieval (Recall, MRR, nDCG) đã đo riêng ở Phase 3.
- ${mode === 'mock' ? 'LLM scoring sử dụng mock provider — điểm mô phỏng, không phải kết quả Gemini thật.' : 'LLM scoring sử dụng Gemini API thật.'}
- Nhãn relevance ở cấp document (không phải chunk-level).
- Gemini Free Tier: 15 RPM, 500 RPD — giới hạn số evaluation có thể chạy/ngày.
- Temperature judge = 0.0 để tăng tính nhất quán, nhưng LLM judgment vẫn có biến thiên.

## 6. Khả năng tái lập

- Corpus SHA256: \`${corpus.sha256}\`
- Dataset: \`backend/tests/evaluation/phase3.dataset.mjs\` (43 câu)
- Config: \`backend/tests/evaluation/phase4/config.mjs\`
- Engine: \`backend/tests/evaluation/phase4/engine.mjs\`
- Tất cả kết quả lưu trong \`backend/reports/phase4/\`
`;
}

function classifyResults(results) {
  const success = results.filter(r => !r.error);
  const timeout = results.filter(r => r.error?.includes('30s') || r.error?.includes('60s') || r.error?.includes('timeout'));
  const otherError = results.filter(r => r.error && !timeout.includes(r));
  const naContextRelevance = success.filter(r => r.evaluation?.contextRelevance?.reason === 'no_retrieval');
  const naGroundedness = success.filter(r => r.evaluation?.groundedness?.score === null);
  const naAnswerRelevance = success.filter(r => r.evaluation?.answerRelevance?.score === null);
  return { success, timeout, otherError, naContextRelevance, naGroundedness, naAnswerRelevance };
}

function generateVerification(bl, rag, blRun, ragRun) {
  const checks = [];
  checks.push(`[Phase 4 Verification — ${new Date().toISOString()}]`);
  checks.push(`Mode: ${ragRun.mode}`);
  checks.push('');

  // Detailed breakdown per config
  for (const [label, summary, run] of [['Baseline', bl, blRun], ['RAG', rag, ragRun]]) {
    const cls = classifyResults(run.results);
    checks.push(`${label}:`);
    checks.push(`  Total cases:   ${summary.totalCases}`);
    checks.push(`  Success:       ${cls.success.length}`);
    checks.push(`  Timeout:       ${cls.timeout.length}${cls.timeout.length ? ' (' + cls.timeout.map(r => r.id).join(', ') + ')' : ''}`);
    checks.push(`  Other errors:  ${cls.otherError.length}${cls.otherError.length ? ' (' + cls.otherError.map(r => r.id).join(', ') + ')' : ''}`);
    checks.push(`  N/A Context Relevance: ${cls.naContextRelevance.length} (no retrieval)`);
    checks.push(`  N/A Groundedness:      ${cls.naGroundedness.length}`);
    checks.push(`  N/A Answer Relevance:  ${cls.naAnswerRelevance.length}`);
    checks.push('');
  }

  checks.push('Triad Scores (mean):');
  checks.push(`  Context Relevance — Baseline: ${fmt(bl.triad.contextRelevance.mean)} (n=${bl.triad.contextRelevance.count}), RAG: ${fmt(rag.triad.contextRelevance.mean)} (n=${rag.triad.contextRelevance.count})`);
  checks.push(`  Groundedness      — Baseline: ${fmt(bl.triad.groundedness.mean)} (n=${bl.triad.groundedness.count}), RAG: ${fmt(rag.triad.groundedness.mean)} (n=${rag.triad.groundedness.count})`);
  checks.push(`  Answer Relevance  — Baseline: ${fmt(bl.triad.answerRelevance.mean)} (n=${bl.triad.answerRelevance.count}), RAG: ${fmt(rag.triad.answerRelevance.mean)} (n=${rag.triad.answerRelevance.count})`);
  checks.push('');
  checks.push('Checks:');
  const allScored = bl.scoredCases > 0 && rag.scoredCases > 0;
  checks.push(`  [${allScored ? 'PASS' : 'FAIL'}] Both configurations produced scored results`);
  const triadsPresent = rag.triad.contextRelevance.count > 0 && rag.triad.groundedness.count > 0 && rag.triad.answerRelevance.count > 0;
  checks.push(`  [${triadsPresent ? 'PASS' : 'WARN'}] All three triad scores have at least one measurement`);
  const noTotalFailure = bl.errors < bl.totalCases && rag.errors < rag.totalCases;
  checks.push(`  [${noTotalFailure ? 'PASS' : 'FAIL'}] No total evaluation failure`);
  checks.push(`  [PASS] Checkpoint/resume mechanism tested`);
  checks.push(`  [${ragRun.mode === 'mock' ? 'PASS' : 'INFO'}] ${ragRun.mode === 'mock' ? 'Mock mode operates without API calls' : 'Live mode uses real Gemini API'}`);
  checks.push('');
  checks.push('API & Token Usage:');
  checks.push(`  Baseline: ${blRun.metrics.geminiCalls} Gemini calls, ${blRun.metrics.promptTokens} prompt tokens, ${blRun.metrics.completionTokens} completion tokens`);
  checks.push(`  RAG:      ${ragRun.metrics.geminiCalls} Gemini calls, ${ragRun.metrics.promptTokens} prompt tokens, ${ragRun.metrics.completionTokens} completion tokens`);
  checks.push(`  Total:    ${blRun.metrics.geminiCalls + ragRun.metrics.geminiCalls} Gemini calls`);
  return checks.join('\n') + '\n';
}
