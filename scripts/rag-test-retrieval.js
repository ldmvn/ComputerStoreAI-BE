#!/usr/bin/env node

/**
 * Retrieval Test Suite — tests hybrid retrieval quality against real indexed data.
 * Runs semantic, BM25, and hybrid searches for various query types and prints
 * results with scores and retrieval metadata for RAG Triad evaluation.
 *
 * Usage: node scripts/rag-test-retrieval.js
 * LIVE smoke test: embeds each query via Gemini and incurs API cost.
 * For offline evaluation use: node tests/evaluation/phase3.benchmark.mjs
 */

import 'dotenv/config';
import { GeminiEmbeddingProvider } from '../src/ai/rag/embeddings/gemini.embedding.js';
import { JsonVectorStore } from '../src/ai/rag/vectorstores/jsonVectorStore.js';
import { BM25Index } from '../src/ai/rag/retrieval/bm25.js';
import { HybridRetriever } from '../src/ai/rag/retrieval/hybridRetriever.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data', 'rag');

const TEST_QUERIES = [
  // CPU queries
  { query: 'CPU Intel Core i5 cho gaming', category: 'CPU', expectKeywords: ['i5', 'Intel'] },
  { query: 'bộ vi xử lý AMD Ryzen 5', category: 'CPU', expectKeywords: ['Ryzen', 'AMD'] },
  { query: 'CPU rẻ nhất cho văn phòng', category: 'CPU', expectKeywords: ['i3', 'Intel'] },

  // GPU queries
  { query: 'Card màn hình RTX 4060', category: 'GPU', expectKeywords: ['RTX', '4060'] },
  { query: 'VGA giá rẻ chơi game', category: 'GPU', expectKeywords: ['VGA', 'card'] },

  // RAM queries
  { query: 'RAM DDR5 32GB', category: 'RAM', expectKeywords: ['DDR5', '32GB'] },
  { query: 'RAM Corsair Vengeance', category: 'RAM', expectKeywords: ['Corsair'] },

  // SSD queries
  { query: 'Ổ cứng SSD NVMe 1TB', category: 'SSD', expectKeywords: ['SSD', 'NVMe'] },
  { query: 'SSD Samsung 990 Pro', category: 'SSD', expectKeywords: ['Samsung', '990'] },

  // Compatibility queries
  { query: 'mainboard socket LGA 1700', category: 'compatibility', expectKeywords: ['LGA 1700', 'mainboard'] },
  { query: 'tản nhiệt cho Intel thế hệ 12', category: 'compatibility', expectKeywords: ['tản nhiệt', 'Intel'] },

  // Model/SKU queries
  { query: 'MSI MAG B660M', category: 'model', expectKeywords: ['MSI', 'B660'] },
  { query: 'Logitech G Pro X', category: 'model', expectKeywords: ['Logitech'] },

  // Policy queries
  { query: 'chính sách bảo hành', category: 'policy', expectKeywords: ['bảo hành'] },
  { query: 'đổi trả hoàn tiền', category: 'policy', expectKeywords: ['đổi trả'] },
  { query: 'phương thức thanh toán', category: 'policy', expectKeywords: ['thanh toán'] },

  // Build PC / combo queries
  { query: 'build PC gaming 15 triệu', category: 'build', expectKeywords: ['PC', 'gaming'] },
  { query: 'case và nguồn cho build PC', category: 'build', expectKeywords: ['case', 'nguồn'] },
];

async function main() {
  console.log('=== Retrieval Test Suite ===\n');

  // Load components
  const embeddingProvider = new GeminiEmbeddingProvider();
  const vectorStore = new JsonVectorStore({ dir: DATA_DIR });
  const bm25Index = new BM25Index();

  // Load BM25 corpus from disk
  const corpusPath = join(DATA_DIR, 'bm25-corpus.json');
  const corpus = JSON.parse(await readFile(corpusPath, 'utf-8'));
  bm25Index.build(corpus);

  const indexCount = await vectorStore.count();
  console.log(`Vector store: ${indexCount} chunks`);
  console.log(`BM25 index: ${bm25Index.size} documents`);
  console.log('');

  const hybridRetriever = new HybridRetriever({ embeddingProvider, vectorStore, bm25Index });

  const results = [];
  let passed = 0;

  for (const testCase of TEST_QUERIES) {
    console.log(`--- Query [${testCase.category}]: "${testCase.query}" ---`);

    try {
      const topK = 5;
      const hybridResults = await hybridRetriever.retrieve({ query: testCase.query, topK });

      const hasRelevant = hybridResults.some(r => {
        const text = (r.content + ' ' + (r.metadata?.title || '')).toLowerCase();
        return testCase.expectKeywords.some(kw => text.includes(kw.toLowerCase()));
      });

      if (hasRelevant) passed++;

      for (let i = 0; i < Math.min(3, hybridResults.length); i++) {
        const r = hybridResults[i];
        const title = r.metadata?.title || r.id;
        const method = r.retrieval?.method || r.metadata?.retrievalMethod || '?';
        const semScore = r.retrieval?.semanticScore?.toFixed(4) || '-';
        const bm25Score = r.retrieval?.bm25Score?.toFixed(2) || '-';
        console.log(`  #${i + 1} [${method}] RRF=${r.score.toFixed(4)} sem=${semScore} bm25=${bm25Score}`);
        console.log(`     ${title.substring(0, 80)}`);
      }

      results.push({
        query: testCase.query,
        category: testCase.category,
        relevant: hasRelevant,
        topResults: hybridResults.slice(0, 3).map(r => ({
          id: r.id,
          title: r.metadata?.title?.substring(0, 60),
          score: r.score,
          method: r.retrieval?.method,
        })),
      });

      console.log(`  → ${hasRelevant ? 'PASS' : 'MISS'}`);
      console.log('');

      // Rate limit: small delay between queries
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.log(`  → ERROR: ${err.message}`);
      results.push({ query: testCase.query, category: testCase.category, relevant: false, error: err.message });
      console.log('');
      // Wait longer on errors (probably rate limit)
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('=== Summary ===');
  console.log(`Total: ${TEST_QUERIES.length} queries`);
  console.log(`Passed: ${passed}/${TEST_QUERIES.length} (${(passed/TEST_QUERIES.length*100).toFixed(0)}%)`);

  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.relevant) byCategory[r.category].passed++;
  }
  console.log('\nBy category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${stats.passed}/${stats.total}`);
  }
}

main().catch(err => { console.error('Test suite failed:', err); process.exit(1); });
