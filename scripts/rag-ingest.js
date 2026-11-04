#!/usr/bin/env node

/**
 * RAG Ingest CLI — runs the embedding pipeline.
 *
 * Usage:
 *   node scripts/rag-ingest.js                    # Full ingest (all products + policies)
 *   node scripts/rag-ingest.js --skip-embedding   # BM25-only, no Gemini API calls
 *   node scripts/rag-ingest.js --product 123 456  # Incremental: specific product IDs only
 */

import 'dotenv/config';
import { IngestPipeline } from '../src/ai/rag/pipeline/ingestPipeline.js';

const args = process.argv.slice(2);
const skipEmbedding = args.includes('--skip-embedding');
const productIdx = args.indexOf('--product');
const productIds = productIdx !== -1
  ? args.slice(productIdx + 1).filter(a => !a.startsWith('--')).map(Number).filter(n => n > 0)
  : null;

console.log('=== RAG Ingest Pipeline ===');
console.log(`Mode: ${skipEmbedding ? 'BM25-only (no embedding)' : 'Full (embedding + BM25)'}`);
if (productIds?.length) console.log(`Products: ${productIds.join(', ')}`);
console.log('');

try {
  const pipeline = new IngestPipeline();
  if (productIdx !== -1 && !productIds?.length) throw new Error('--product requires valid positive product IDs');
  const report = await pipeline.run({ ...(productIds?.length ? { productIds } : {}), skipEmbedding });

  console.log('');
  console.log('=== Ingest Report ===');
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (err) {
  console.error('Pipeline failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
