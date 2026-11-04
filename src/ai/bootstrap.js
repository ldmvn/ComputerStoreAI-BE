import { isChatConfigured, aiConfig } from './config/ai.config.js';
import { setProvider } from './services/aiChat.service.js';
import { setBuildPcProvider } from './services/aiBuildPc.service.js';
import { initializeRag } from './rag/rag.service.js';
import { startKnowledgeSync } from './rag/sync/knowledgeSync.js';

export async function bootstrapAI() {
  await initializeRag();
  startKnowledgeSync();
  if (!isChatConfigured()) {
    console.log('[AI] Disabled — AI_ENABLED/AI_PROVIDER/AI_MODEL not configured.');
    return;
  }

  const { provider, model } = aiConfig;

  if (provider === 'gemini') {
    const { GeminiProvider } = await import('./providers/gemini.provider.js');
    const gemini = new GeminiProvider({ model });
    setProvider(gemini);
    setBuildPcProvider(gemini);

    const health = await gemini.healthCheck();
    if (health.ok) {
      console.log(`[AI] Gemini provider ready (model: ${model}).`);
    } else {
      console.warn(`[AI] Gemini health check failed: ${health.reason}`);
    }
  } else {
    console.warn(`[AI] Provider "${provider}" is configured but has no adapter yet.`);
  }

}
