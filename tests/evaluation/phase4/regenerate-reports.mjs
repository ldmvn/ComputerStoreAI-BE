#!/usr/bin/env node
// Regenerate reports from checkpoint JSONL files (after retry patching).
// Usage: node tests/evaluation/phase4/regenerate-reports.mjs --output-dir reports/phase4/live

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadCorpus, evalConfig } from './config.mjs';
import { generateReports } from './reporter.mjs';

const args = process.argv.slice(2);
const outputDir = args.includes('--output-dir')
  ? resolve(args[args.indexOf('--output-dir') + 1])
  : resolve('reports/phase4/live');

async function loadCheckpoint(path) {
  const lines = (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

async function main() {
  const { corpus, sha256 } = await loadCorpus();
  const corpusInfo = {
    chunks: corpus.length,
    documents: new Set(corpus.map(d => (d.metadata?.documentId || d.id).split('::')[0])).size,
    sha256,
  };

  const blResults = await loadCheckpoint(join(outputDir, 'baseline-phase4-checkpoint.jsonl'));
  const ragResults = await loadCheckpoint(join(outputDir, 'rag-phase4-checkpoint.jsonl'));

  // Reconstruct metrics from results
  function countMetrics(results) {
    let geminiCalls = 0, promptTokens = 0, completionTokens = 0, embeddingCalls = 0, errors = 0;
    for (const r of results) {
      if (r.error) { errors++; continue; }
      // Each successful item: 1 generator + up to 3 judge calls (CR, groundedness extract+verify, AR)
      const hasRetrieval = r.retrievedChunks > 0;
      const hasResponse = !!r.response;
      geminiCalls += hasResponse ? 1 : 0; // generator
      if (hasRetrieval && r.evaluation?.contextRelevance?.score !== null) geminiCalls++; // CR judge
      if (hasResponse && r.evaluation?.groundedness?.claimCount > 0) geminiCalls += 2; // extract + verify
      if (hasResponse && r.evaluation?.answerRelevance?.score !== null) geminiCalls++; // AR judge
    }
    return { geminiCalls, promptTokens, completionTokens, embeddingCalls, errors };
  }

  const blRun = { results: blResults, metrics: countMetrics(blResults), mode: 'live', label: 'baseline', corpusSha: sha256 };
  const ragRun = { results: ragResults, metrics: countMetrics(ragResults), mode: 'live', label: 'rag', corpusSha: sha256 };

  console.log(`Baseline: ${blResults.length} items (${blResults.filter(r => r.error).length} errors)`);
  console.log(`RAG: ${ragResults.length} items (${ragResults.filter(r => r.error).length} errors)`);

  const { baselineSummary, ragSummary } = await generateReports(blRun, ragRun, corpusInfo, { reportsDir: outputDir });

  console.log('\n=== RAG Triad Summary (post-retry) ===');
  console.log('                    Baseline    RAG');
  console.log(`Context Relevance:  ${fmt(baselineSummary.triad.contextRelevance.mean)}      ${fmt(ragSummary.triad.contextRelevance.mean)}`);
  console.log(`Groundedness:       ${fmt(baselineSummary.triad.groundedness.mean)}      ${fmt(ragSummary.triad.groundedness.mean)}`);
  console.log(`Answer Relevance:   ${fmt(baselineSummary.triad.answerRelevance.mean)}      ${fmt(ragSummary.triad.answerRelevance.mean)}`);
  console.log(`Hallucination Rate: ${fmt(baselineSummary.hallucinationRate.mean)}      ${fmt(ragSummary.hallucinationRate.mean)}`);
  console.log(`\nReports saved to: ${outputDir}`);
}

function fmt(v) { return v !== null && v !== undefined ? v.toFixed(4).padStart(8) : '     N/A'; }

main().catch(err => { console.error('Fatal:', err); process.exitCode = 1; });
