import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBackendEnvironment } from '../../src/config/env.js';

test('SMTP config reloads local credentials in dev and preserves production injection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'computerstoreai-smtp-env-'));
  const path = join(directory, '.env');
  try {
    await writeFile(path, 'SMTP_HOST=smtp.gmail.com\nSMTP_PORT=587\nSMTP_USER=new@example.com\nSMTP_PASS=test-only-initial\nSMTP_FROM="PC <new@example.com>"\nPORT=5000\n');
    const development = { NODE_ENV: 'development', SMTP_USER: 'old@example.com', SMTP_PASS: 'test-only-inherited', PORT: '5091' };
    loadBackendEnvironment({ path, environment: development });
    assert.equal(development.SMTP_USER, 'new@example.com');
    assert.equal(development.SMTP_PASS, 'test-only-initial');
    assert.equal(development.PORT, '5091', 'Other inherited settings retain their existing precedence');
    await writeFile(path, 'SMTP_USER=new@example.com\nSMTP_PASS=test-only-updated\n');
    loadBackendEnvironment({ path, environment: development });
    assert.equal(development.SMTP_PASS, 'test-only-updated', 'Restart reads a newly edited App Password');
    const production = { NODE_ENV: 'production', SMTP_USER: 'deploy@example.com', SMTP_PASS: 'test-only-injected' };
    loadBackendEnvironment({ path, environment: production });
    assert.equal(production.SMTP_USER, 'deploy@example.com');
    assert.equal(production.SMTP_PASS, 'test-only-injected');
  } finally {
    const resolved = resolve(directory);
    assert.equal(resolved.startsWith(resolve(tmpdir()) + '\\') || resolved.startsWith(resolve(tmpdir()) + '/'), true);
    await rm(resolved, { recursive: true, force: true });
  }
});
