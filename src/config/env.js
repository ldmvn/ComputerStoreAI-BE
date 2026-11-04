import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const backendEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

export function loadBackendEnvironment({ path = backendEnvPath, environment = process.env } = {}) {
  const result = dotenv.config({ path, processEnv: environment });
  // The dev launcher may inherit old SMTP values. Local .env must win for these
  // keys on each backend restart; production still respects injected variables.
  if (environment.NODE_ENV !== 'production' && result.parsed) {
    for (const key of smtpKeys) {
      if (Object.hasOwn(result.parsed, key)) environment[key] = result.parsed[key];
    }
  }
  return result;
}

loadBackendEnvironment();
