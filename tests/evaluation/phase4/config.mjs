// Phase 4 evaluation configuration — frozen for reproducibility.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../../fixtures/rag-phase3-corpus.json', import.meta.url));

export async function loadCorpus() {
  const raw = await readFile(fixturePath, 'utf8');
  const corpus = JSON.parse(raw);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  return { corpus, sha256, raw };
}

export const evalConfig = Object.freeze({
  generatorModel: 'gemini-2.0-flash-lite',
  judgeModel: 'gemini-2.0-flash-lite',
  embeddingModel: 'gemini-embedding-001',
  topK: 5,
  maxTokensJudge: 400,
  temperatureJudge: 0.0,
  maxTokensGenerator: 900,
  temperatureGenerator: 0.2,
  // Rate limiting for Gemini Free Tier: 15 RPM, 500 RPD
  rateLimitDelayMs: 4500,
  maxRetries: 3,
  retryBaseDelayMs: 61_000,
  // Checkpoint
  checkpointFile: 'phase4-checkpoint.jsonl',
  // Scoring scale
  scale: { min: 0, max: 1, step: 0.1 },
});
