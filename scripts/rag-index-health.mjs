import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonVectorStore } from '../src/ai/rag/vectorstores/jsonVectorStore.js';
import { IngestPipeline } from '../src/ai/rag/pipeline/ingestPipeline.js';
import { KnowledgeSync } from '../src/ai/rag/sync/knowledgeSync.js';
import { ragDataDirectory } from '../src/ai/rag/storage/atomicJson.js';

const dataDir = ragDataDirectory();
try {
  const store = new JsonVectorStore({ dir: dataDir });
  const canonical = await store.getAllContent();
  let lexical = [], lexicalError = null;
  try {
    lexical = JSON.parse(await readFile(join(dataDir, 'bm25-corpus.json'), 'utf8'));
    if (!Array.isArray(lexical) || lexical.some(r => !r?.id || typeof r.content !== 'string' || !r.metadata)) throw new Error('Invalid lexical corpus');
  } catch (e) { lexical = []; lexicalError = e.message; }
  const signature = docs => JSON.stringify(docs.map(d => [d.id, d.content, d.metadata]).sort((a, b) => a[0].localeCompare(b[0])));
  let aligned = !lexicalError && signature(canonical) === signature(lexical);
  let repaired = false;
  if (process.argv.includes('--repair') && canonical.length) {
    if (store.recovered) await store.upsert([]); // atomically restore a valid backup
    const pipeline = new IngestPipeline({ dataDir, vectorStore: store });
    await pipeline.repairBm25();
    aligned = true; repaired = true; lexicalError = null;
  }
  const sync = new KnowledgeSync({ dataDir });
  const pendingJobs = sync.recover(); sync.stop();
  const report = { dataDir, vectors: canonical.length, bm25Chunks: repaired ? canonical.length : lexical.length,
    aligned, recoveredBackup: store.recovered, repaired, pendingJobs, lexicalError,
    sourceReconciliationRequired: !canonical.length || store.recovered || pendingJobs > 0 };
  console.log(JSON.stringify(report, null, 2));
  if (!aligned || !canonical.length) process.exitCode = 1;
} catch (err) {
  console.error(JSON.stringify({ error: err.message, recovery: 'Run rag-ingest.js to rebuild from MySQL; corrupt snapshots are preserved. No database reset is needed.' }));
  process.exitCode = 1;
}
