#!/usr/bin/env node
// Retry only timeout/error items from a completed live evaluation checkpoint.
// Usage: node tests/evaluation/phase4/retry-timeouts.mjs --output-dir reports/phase4/live
//
// Reads the checkpoint JSONL files, finds items with errors, retries them
// with a longer timeout and up to 2 attempts per item, then patches the checkpoint.

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { EvaluationEngine } from './engine.mjs';
import { dataset } from '../phase3.dataset.mjs';

const args = process.argv.slice(2);
const outputDir = args.includes('--output-dir')
  ? resolve(args[args.indexOf('--output-dir') + 1])
  : resolve('reports/phase4/live');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

async function loadCheckpoint(path) {
  try {
    const lines = (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
  } catch { return []; }
}

async function retryLabel(label, provider) {
  const cpPath = join(outputDir, `${label}-phase4-checkpoint.jsonl`);
  const results = await loadCheckpoint(cpPath);
  if (!results.length) {
    console.log(`[Retry] No checkpoint for ${label}, skipping.`);
    return { retried: 0, recovered: 0, stillFailed: 0 };
  }

  const errorItems = results.filter(r => r.error);
  if (!errorItems.length) {
    console.log(`[Retry][${label}] No errors to retry.`);
    return { retried: 0, recovered: 0, stillFailed: 0 };
  }

  console.log(`[Retry][${label}] Found ${errorItems.length} error items: ${errorItems.map(e => e.id).join(', ')}`);

  const engine = new EvaluationEngine({ provider, judge: provider, mode: 'live', reportsDir: outputDir });
  await engine.initialize();

  const useRag = label === 'rag';
  let recovered = 0;
  let stillFailed = 0;

  for (const errorResult of errorItems) {
    const item = dataset.find(d => d.id === errorResult.id);
    if (!item) {
      console.log(`[Retry][${label}] ${errorResult.id}: not found in dataset, skipping.`);
      stillFailed++;
      continue;
    }

    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Retry][${label}] ${item.id} attempt ${attempt}/${MAX_RETRIES}...`);
        const result = await engine.evaluateItem(item, { useRag });
        // Replace error entry in results array
        const idx = results.findIndex(r => r.id === errorResult.id);
        results[idx] = result;
        recovered++;
        success = true;
        console.log(`[Retry][${label}] ${item.id}: RECOVERED`);
        break;
      } catch (err) {
        console.log(`[Retry][${label}] ${item.id} attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    if (!success) {
      stillFailed++;
      console.log(`[Retry][${label}] ${item.id}: STILL FAILED after ${MAX_RETRIES} attempts`);
    }
  }

  // Rewrite checkpoint with patched results
  const newLines = results.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(cpPath, newLines);
  console.log(`[Retry][${label}] Checkpoint updated. Recovered: ${recovered}, Still failed: ${stillFailed}`);

  return { retried: errorItems.length, recovered, stillFailed };
}

async function main() {
  console.log(`[Retry] Output dir: ${outputDir}`);
  console.log(`[Retry] Max retries per item: ${MAX_RETRIES}, timeout: ${process.env.AI_PROVIDER_TIMEOUT_MS || '60000'}ms\n`);

  const { GeminiProvider } = await import('../../../src/ai/providers/gemini.provider.js');
  const provider = new GeminiProvider();

  const blStats = await retryLabel('baseline', provider);
  console.log('');
  const ragStats = await retryLabel('rag', provider);

  console.log('\n=== Retry Summary ===');
  console.log(`Baseline: ${blStats.retried} retried, ${blStats.recovered} recovered, ${blStats.stillFailed} still failed`);
  console.log(`RAG:      ${ragStats.retried} retried, ${ragStats.recovered} recovered, ${ragStats.stillFailed} still failed`);
}

main().catch(err => { console.error('[Retry] Fatal:', err); process.exitCode = 1; });
