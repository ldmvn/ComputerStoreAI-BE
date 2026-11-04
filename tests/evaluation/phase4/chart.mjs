// Generates an HTML chart page from evaluation.json
// Usage: node tests/evaluation/phase4/chart.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const REPORTS_DIR = args.includes('--dir') ? resolve(args[args.indexOf('--dir') + 1]) : fileURLToPath(new URL('../../../reports/phase4', import.meta.url));

async function main() {
  const data = JSON.parse(await readFile(join(REPORTS_DIR, 'evaluation.json'), 'utf8'));
  const bl = data.baseline.summary;
  const rag = data.rag.summary;

  const triadData = {
    labels: ['Context Relevance', 'Groundedness', 'Answer Relevance'],
    baseline: [bl.triad.contextRelevance.mean, bl.triad.groundedness.mean, bl.triad.answerRelevance.mean],
    rag: [rag.triad.contextRelevance.mean, rag.triad.groundedness.mean, rag.triad.answerRelevance.mean],
  };

  const categories = Object.keys(data.rag.byCategory);
  const catData = categories.map(cat => ({
    name: cat,
    baseline: {
      cr: data.baseline.byCategory[cat]?.triad?.contextRelevance?.mean,
      gr: data.baseline.byCategory[cat]?.triad?.groundedness?.mean,
      ar: data.baseline.byCategory[cat]?.triad?.answerRelevance?.mean,
    },
    rag: {
      cr: data.rag.byCategory[cat]?.triad?.contextRelevance?.mean,
      gr: data.rag.byCategory[cat]?.triad?.groundedness?.mean,
      ar: data.rag.byCategory[cat]?.triad?.answerRelevance?.mean,
    }
  }));

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Phase 4 — RAG Triad Evaluation</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js"></script>
<style>
:root { --bg: #ffffff; --text: #1e293b; --card: #f8fafc; --border: #e2e8f0; --accent: #2563eb; --accent2: #f59e0b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f172a; --text: #e2e8f0; --card: #1e293b; --border: #334155; --accent: #60a5fa; --accent2: #fbbf24; } }
:root[data-theme="dark"] { --bg: #0f172a; --text: #e2e8f0; --card: #1e293b; --border: #334155; --accent: #60a5fa; --accent2: #fbbf24; }
* { margin: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 16px; max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin-bottom: 4px; }
h2 { font-size: 1.1rem; margin: 24px 0 12px; }
.subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 20px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.chart-container { position: relative; height: 300px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
th { font-weight: 600; }
.mode-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
.mode-mock { background: #fef3c7; color: #92400e; }
.mode-live { background: #d1fae5; color: #065f46; }
.metric { font-size: 1.8rem; font-weight: 700; }
.metric-label { font-size: 0.75rem; color: #64748b; }
</style>
</head>
<body>
<h1>DUCMANH PC — RAG Triad Evaluation</h1>
<p class="subtitle">Phase 4 | ${data.generatedAt?.split('T')[0] || 'N/A'} | <span class="mode-badge mode-${data.config.mode}">${data.config.mode === 'live' ? 'LIVE' : 'MOCK'}</span> | ${data.corpus.chunks} chunks, ${data.corpus.documents} docs</p>

<div class="grid">
  <div class="card" style="text-align:center">
    <div class="metric">${rag.triad.contextRelevance.mean !== null ? (rag.triad.contextRelevance.mean * 100).toFixed(1) + '%' : 'N/A'}</div>
    <div class="metric-label">Context Relevance (RAG)</div>
  </div>
  <div class="card" style="text-align:center">
    <div class="metric">${rag.triad.groundedness.mean !== null ? (rag.triad.groundedness.mean * 100).toFixed(1) + '%' : 'N/A'}</div>
    <div class="metric-label">Groundedness (RAG)</div>
  </div>
  <div class="card" style="text-align:center">
    <div class="metric">${rag.triad.answerRelevance.mean !== null ? (rag.triad.answerRelevance.mean * 100).toFixed(1) + '%' : 'N/A'}</div>
    <div class="metric-label">Answer Relevance (RAG)</div>
  </div>
  <div class="card" style="text-align:center">
    <div class="metric">${rag.hallucinationRate.mean !== null ? (rag.hallucinationRate.mean * 100).toFixed(1) + '%' : 'N/A'}</div>
    <div class="metric-label">Hallucination Rate (RAG)</div>
  </div>
</div>

<h2>RAG Triad — Baseline vs Hybrid RAG</h2>
<div class="card"><div class="chart-container"><canvas id="triadChart"></canvas></div></div>

<h2>Phân tích theo nhóm câu hỏi</h2>
<div class="card"><div class="chart-container"><canvas id="catChart"></canvas></div></div>

<h2>Bảng chi tiết</h2>
<div class="card">
<table>
<tr><th>Metric</th><th>Baseline</th><th>Hybrid RAG</th><th>Δ</th></tr>
<tr><td>Context Relevance</td><td>${fmt(bl.triad.contextRelevance.mean)}</td><td>${fmt(rag.triad.contextRelevance.mean)}</td><td>${delta(bl.triad.contextRelevance.mean, rag.triad.contextRelevance.mean)}</td></tr>
<tr><td>Groundedness</td><td>${fmt(bl.triad.groundedness.mean)}</td><td>${fmt(rag.triad.groundedness.mean)}</td><td>${delta(bl.triad.groundedness.mean, rag.triad.groundedness.mean)}</td></tr>
<tr><td>Answer Relevance</td><td>${fmt(bl.triad.answerRelevance.mean)}</td><td>${fmt(rag.triad.answerRelevance.mean)}</td><td>${delta(bl.triad.answerRelevance.mean, rag.triad.answerRelevance.mean)}</td></tr>
<tr><td>Hallucination Rate</td><td>${pct(bl.hallucinationRate.mean)}</td><td>${pct(rag.hallucinationRate.mean)}</td><td>${delta(rag.hallucinationRate.mean, bl.hallucinationRate.mean)}</td></tr>
<tr><td>Citation Support</td><td>${pct(bl.citationSupportRate.mean)}</td><td>${pct(rag.citationSupportRate.mean)}</td><td>—</td></tr>
<tr><td>Latency (median)</td><td>${bl.latency.median?.toFixed(1) ?? 'N/A'} ms</td><td>${rag.latency.median?.toFixed(1) ?? 'N/A'} ms</td><td>—</td></tr>
<tr><td>Gemini Calls</td><td>${data.baseline.metrics.geminiCalls}</td><td>${data.rag.metrics.geminiCalls}</td><td>—</td></tr>
<tr><td>Routing Accuracy</td><td>${pct(bl.routingAccuracy)}</td><td>${pct(rag.routingAccuracy)}</td><td>—</td></tr>
</table>
</div>

<script>
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
Chart.defaults.color = isDark ? '#94a3b8' : '#64748b';
Chart.defaults.borderColor = isDark ? '#334155' : '#e2e8f0';

new Chart(document.getElementById('triadChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(triadData.labels)},
    datasets: [
      { label: 'Baseline (FC only)', data: ${JSON.stringify(triadData.baseline.map(v => v !== null ? +(v*100).toFixed(1) : 0))}, backgroundColor: isDark ? '#60a5fa' : '#3b82f6', borderRadius: 6 },
      { label: 'Hybrid RAG + FC', data: ${JSON.stringify(triadData.rag.map(v => v !== null ? +(v*100).toFixed(1) : 0))}, backgroundColor: isDark ? '#fbbf24' : '#f59e0b', borderRadius: 6 },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Score (%)' } } }, plugins: { legend: { position: 'top' } } },
});

const catLabels = ${JSON.stringify(catData.map(c => c.name))};
new Chart(document.getElementById('catChart'), {
  type: 'bar',
  data: {
    labels: catLabels,
    datasets: [
      { label: 'RAG — Context Relevance', data: ${JSON.stringify(catData.map(c => c.rag.cr !== null && c.rag.cr !== undefined ? +(c.rag.cr*100).toFixed(1) : 0))}, backgroundColor: '#3b82f6', borderRadius: 4 },
      { label: 'RAG — Groundedness', data: ${JSON.stringify(catData.map(c => c.rag.gr !== null && c.rag.gr !== undefined ? +(c.rag.gr*100).toFixed(1) : 0))}, backgroundColor: '#10b981', borderRadius: 4 },
      { label: 'RAG — Answer Relevance', data: ${JSON.stringify(catData.map(c => c.rag.ar !== null && c.rag.ar !== undefined ? +(c.rag.ar*100).toFixed(1) : 0))}, backgroundColor: '#f59e0b', borderRadius: 4 },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Score (%)' } } }, plugins: { legend: { position: 'top' } } },
});
</script>
</body>
</html>`;

  const chartPath = join(REPORTS_DIR, 'chart.html');
  await writeFile(chartPath, html);
  console.log(`Chart saved to ${chartPath}`);
}

function fmt(v) { return v !== null && v !== undefined ? (v * 100).toFixed(1) + '%' : 'N/A'; }
function pct(v) { return v !== null && v !== undefined ? (v * 100).toFixed(1) + '%' : 'N/A'; }
function delta(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return 'N/A';
  const d = (b - a) * 100;
  return (d > 0 ? '+' : '') + d.toFixed(1) + '%';
}

main().catch(err => { console.error(err); process.exitCode = 1; });
