import { isChatConfigured, aiConfig } from './config/ai.config.js';
import { setProvider } from './services/aiChat.service.js';
import { setBuildPcProvider } from './services/aiBuildPc.service.js';
import { initializeRag } from './rag/rag.service.js';
import { startKnowledgeSync } from './rag/sync/knowledgeSync.js';

async function createProvider(providerName, modelName) {
  if (providerName === 'gemini') {
    const { GeminiProvider } = await import('./providers/gemini.provider.js');
    return new GeminiProvider({ model: modelName });
  }
  if (providerName === 'openrouter') {
    const { OpenRouterProvider } = await import('./providers/openrouter.provider.js');
    return new OpenRouterProvider({ model: modelName });
  }
  if (providerName === 'deepseek') {
    const { OpenRouterProvider } = await import('./providers/openrouter.provider.js');
    return new OpenRouterProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: modelName,
      baseUrl: 'https://api.deepseek.com/v1',
    });
  }
  if (providerName === 'openai') {
    const { OpenRouterProvider } = await import('./providers/openrouter.provider.js');
    return new OpenRouterProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: modelName,
      baseUrl: 'https://api.openai.com/v1',
    });
  }
  if (providerName === 'anthropic') {
    const { AnthropicProvider } = await import('./providers/anthropic.provider.js');
    return new AnthropicProvider({ model: modelName });
  }
  return null;
}

export async function bootstrapAI() {
  await initializeRag();
  startKnowledgeSync();
  if (!isChatConfigured()) {
    console.log('[AI] Disabled — AI_ENABLED/AI_PROVIDER/AI_MODEL not configured.');
    return;
  }

  const { provider, model, buildPcProvider, buildPcModel } = aiConfig;

  const chatInstance = await createProvider(provider, model);
  if (!chatInstance) {
    console.warn(`[AI] Chat provider "${provider}" has no adapter yet.`);
    return;
  }
  setProvider(chatInstance);

  const chatHealth = await chatInstance.healthCheck();
  console.log(chatHealth.ok
    ? `[AI] Chat: ${provider} ready (model: ${model}).`
    : `[AI] Chat: ${provider} health check failed: ${chatHealth.reason}`);

  if (buildPcProvider !== provider || buildPcModel !== model) {
    const buildPcInstance = await createProvider(buildPcProvider, buildPcModel);
    if (buildPcInstance) {
      setBuildPcProvider(buildPcInstance);
      const bpHealth = await buildPcInstance.healthCheck();
      console.log(bpHealth.ok
        ? `[AI] Build PC: ${buildPcProvider} ready (model: ${buildPcModel}).`
        : `[AI] Build PC: ${buildPcProvider} health check failed: ${bpHealth.reason}`);
    } else {
      console.warn(`[AI] Build PC provider "${buildPcProvider}" has no adapter — falling back to chat provider.`);
      setBuildPcProvider(chatInstance);
    }
  } else {
    setBuildPcProvider(chatInstance);
  }
}
