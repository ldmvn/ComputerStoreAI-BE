import { open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ragDataDirectory = () => process.env.RAG_DATA_DIR || fileURLToPath(new URL('../../../../data/rag/', import.meta.url));

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(value), 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// OS-visible writer lease; a killed process cannot leave a permanent lock.
export async function withFileLock(path, operation, { timeoutMs = 5000 } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  let lease;
  while (!lease) {
    try {
      lease = await open(path, 'wx');
      await lease.writeFile(JSON.stringify({ pid: process.pid }));
    } catch (err) {
      if (lease) {
        await lease.close(); lease = null;
        await rm(path, { force: true });
      }
      if (err.code !== 'EEXIST') throw err;
      try {
        const info = await stat(path);
        let pid;
        try { pid = JSON.parse(await readFile(path, 'utf8')).pid; } catch { /* incomplete lock */ }
        let alive = true;
        if (Number.isInteger(pid)) {
          try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        }
        if (!alive || !pid && Date.now() - info.mtimeMs > 30_000) { await rm(path, { force: true }); continue; }
      } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (Date.now() - started > timeoutMs) throw new Error(`RAG writer lock timeout: ${path}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await operation(); }
  finally { try { await lease.close(); } finally { await rm(path, { force: true }); } }
}
