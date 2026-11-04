#!/usr/bin/env node
// Phase 4 RAG Triad Evaluation Runner
// Usage:
//   node tests/evaluation/phase4/runner.mjs                  # Mock mode (default)
//   node tests/evaluation/phase4/runner.mjs --mode live      # Live Gemini API
//   node tests/evaluation/phase4/runner.mjs --items 5        # First N items only
//   node tests/evaluation/phase4/runner.mjs --no-checkpoint  # No resume

import 'dotenv/config';
import { resolve } from 'node:path';
import { EvaluationEngine } from './engine.mjs';
import { loadCorpus } from './config.mjs';
import { generateReports } from './reporter.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'mock';
const itemLimit = args.includes('--items') ? parseInt(args[args.indexOf('--items') + 1]) : null;
const checkpoint = !args.includes('--no-checkpoint');
const outputDir = args.includes('--output-dir') ? resolve(args[args.indexOf('--output-dir') + 1]) : undefined;

async function main() {
  console.log(`[Phase 4] RAG Triad Evaluation — mode: ${mode}`);

  let provider = null;
  if (mode === 'live') {
    const { GeminiProvider } = await import('../../../src/ai/providers/gemini.provider.js');
    provider = new GeminiProvider();
  }

  const engineOpts = { provider, judge: provider, mode };
  if (outputDir) engineOpts.reportsDir = outputDir;

  // Run baseline (no RAG)
  console.log('\n=== Baseline (Gemini + FC, no RAG) ===');
  const baselineEngine = new EvaluationEngine(engineOpts);
  const corpusInfo = await baselineEngine.initialize();
  console.log(`Corpus: ${corpusInfo.chunks} chunks, ${corpusInfo.documents} documents`);

  const { dataset } = await import('../phase3.dataset.mjs');
  const items = itemLimit ? dataset.slice(0, itemLimit) : undefined;
  const baselineRun = await baselineEngine.run({ useRag: false, items, checkpoint });
  console.log(`Baseline: ${baselineRun.results.length} results, ${baselineRun.metrics.geminiCalls} API calls`);

  // Run RAG
  console.log('\n=== Hybrid RAG (Semantic + BM25 + FC) ===');
  const ragEngine = new EvaluationEngine(engineOpts);
  await ragEngine.initialize();
  const ragRun = await ragEngine.run({ useRag: true, items, checkpoint });
  console.log(`RAG: ${ragRun.results.length} results, ${ragRun.metrics.geminiCalls} API calls`);

  // Generate reports
  console.log('\n=== Generating Reports ===');
  const reportOpts = outputDir ? { reportsDir: outputDir } : {};
  const { baselineSummary, ragSummary } = await generateReports(baselineRun, ragRun, corpusInfo, reportOpts);

  console.log('\n=== RAG Triad Summary ===');
  console.log('                    Baseline    RAG');
  console.log(`Context Relevance:  ${fmt(baselineSummary.triad.contextRelevance.mean)}      ${fmt(ragSummary.triad.contextRelevance.mean)}`);
  console.log(`Groundedness:       ${fmt(baselineSummary.triad.groundedness.mean)}      ${fmt(ragSummary.triad.groundedness.mean)}`);
  console.log(`Answer Relevance:   ${fmt(baselineSummary.triad.answerRelevance.mean)}      ${fmt(ragSummary.triad.answerRelevance.mean)}`);
  console.log(`Hallucination Rate: ${fmt(baselineSummary.hallucinationRate.mean)}      ${fmt(ragSummary.hallucinationRate.mean)}`);
  console.log(`\nReports saved to: backend/reports/phase4/`);
}

function fmt(v) { return v !== null && v !== undefined ? v.toFixed(4).padStart(8) : '     N/A'; }

main().catch(err => { console.error('[Phase 4] Fatal:', err); process.exitCode = 1; });
