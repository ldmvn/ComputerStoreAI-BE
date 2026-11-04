import { appendFileSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IngestPipeline } from '../pipeline/ingestPipeline.js';
import { aiConfig } from '../../config/ai.config.js';
import { ragDataDirectory } from '../storage/atomicJson.js';

// Append-only journal: persist intent before returning from the CRUD hook.
// Completion acknowledges a particular revision, so an update during embedding survives.
export class KnowledgeSync {
  constructor({ dataDir, pipeline, debounceMs = 10_000, log = console } = {}) {
    this.dataDir = dataDir || ragDataDirectory();
    this.journal = join(this.dataDir, 'sync-journal.jsonl');
    this.pipeline = pipeline;
    this.debounceMs = debounceMs;
    this.log = log;
    this.pending = new Map();
    this.retryMs = debounceMs;
  }
  append(event) {
    mkdirSync(this.dataDir, { recursive: true });
    // Leading newline isolates a partial record left by an abrupt process exit.
    const fd = openSync(this.journal, 'a');
    try { appendFileSync(fd, '\n' + JSON.stringify(event) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  recover() {
    const jobs = new Map();
    try {
      for (const line of readFileSync(this.journal, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { this.log.warn('[KnowledgeSync] Incomplete journal record ignored; startup reconciliation will check sources.'); continue; }
        if (!Number.isSafeInteger(event.id) || event.id <= 0) continue;
        if (event.type === 'queue') jobs.set(event.id, { ...event, persisted: true });
        else if (event.type === 'done' && jobs.get(event.id)?.revision === event.revision) jobs.delete(event.id);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // Preserve in-memory intents when journal persistence itself was unavailable.
    for (const [id, job] of this.pending) if (!job.persisted) jobs.set(id, job);
    this.pending = jobs;
    return jobs.size;
  }
  queue(id, action = 'upsert') {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !['upsert', 'delete'].includes(action)) return false;
    const event = { type: 'queue', id: Number(id), action, revision: randomUUID(), at: Date.now() };
    try { this.append(event); event.persisted = true; }
    catch (err) { this.log.error('[KnowledgeSync] Journal unavailable; intent retained in memory, reconciliation required:', err.message); }
    this.pending.set(event.id, event);
    this.schedule(this.debounceMs);
    return true;
  }
  schedule(ms) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.process(); }, ms);
    this.timer.unref?.();
  }
  process() {
    if (this.running) return this.running;
    this.running = this.drain().catch(err => {
      this.log.error('[KnowledgeSync] Job retained for retry:', err.message);
      this.retryMs = Math.min(300_000, Math.max(100, this.retryMs * 2));
      return { synced: 0, pending: this.pending.size, error: err.message };
    }).finally(() => {
      this.running = null;
      if (this.pending.size) this.schedule(this.retryMs);
    });
    return this.running;
  }
  async drain() {
    clearTimeout(this.timer);
    this.recover();
    const jobs = [...this.pending.values()];
    if (!jobs.length) return { synced: 0 };
    this.pipeline ||= new IngestPipeline({ dataDir: this.dataDir });
    let synced = 0;
    // Process deletes first, independently of an embedding outage for upserts.
    const deletes = jobs.filter(j => j.action === 'delete');
    const upserts = jobs.filter(j => j.action === 'upsert');
    for (const group of [deletes, upserts]) {
      if (!group.length) continue;
      if (group[0].action === 'delete') await this.pipeline.removeProducts(group.map(j => j.id));
      else await this.pipeline.runIncremental(group.map(j => j.id));
      for (const job of group) {
        this.append({ type: 'done', id: job.id, revision: job.revision });
        if (this.pending.get(job.id)?.revision === job.revision) this.pending.delete(job.id);
        synced++;
      }
    }
    this.retryMs = this.debounceMs;
    return { synced, pending: this.pending.size };
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}

const sync = new KnowledgeSync();
export function queueProductSync(id, action = 'upsert') {
  if (!aiConfig.ragEnabled) return false;
  return sync.queue(id, action);
}
export const onProductCreated = id => queueProductSync(id);
export const onProductUpdated = id => queueProductSync(id);
export const onProductDeleted = id => queueProductSync(id, 'delete');
export const processPendingSync = () => sync.process();
export const getPendingCount = () => sync.pending.size;

export function startKnowledgeSync() {
  if (!aiConfig.ragEnabled) return;
  // Full source reconciliation repairs missed hooks, lost journals and missing indexes.
  // Existing vectors are reused by id/content, so unchanged data costs no embeddings.
  async function reconcile() {
    try {
      await sync.process();
      sync.pipeline ||= new IngestPipeline({ dataDir: sync.dataDir });
      await sync.pipeline.run();
    } catch (err) { console.error('[KnowledgeSync] Reconciliation failed; retry scheduled:', err.message); }
  }
  void reconcile();
  const timer = setInterval(() => { void reconcile(); }, 15 * 60_000);
  timer.unref?.();
  return () => { clearInterval(timer); sync.stop(); };
}
