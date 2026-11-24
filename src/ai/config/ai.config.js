// Single source of truth for whether any AI capability is actually wired up.
// Every other AI module reads its "am I allowed to run" answer from here
// instead of poking process.env directly, so flipping these env vars is the
// only thing needed to light up a capability once a real provider exists.
//
// Nothing here calls out to a network. Booleans default to false/off until
// an operator explicitly configures a real provider — see backend/.env.example.

function flag(name) {
  return String(process.env[name] ?? '').trim().toLowerCase() === 'true';
}

function str(name) {
  return String(process.env[name] ?? '').trim();
}

const SUPPORTED_AI_PROVIDERS = new Set(['openai', 'gemini', 'openrouter', 'deepseek', 'anthropic', 'python']);
const SUPPORTED_VECTOR_STORES = new Set(['qdrant', 'memory', 'json']);
const SUPPORTED_EMBEDDING_PROVIDERS = new Set(['openai', 'gemini']);

export const aiConfig = Object.freeze({
  enabled: flag('AI_ENABLED'),
  provider: str('AI_PROVIDER').toLowerCase(),
  model: str('AI_MODEL'),

  buildPcProvider: (str('AI_BUILDPC_PROVIDER') || str('AI_PROVIDER')).toLowerCase(),
  buildPcModel: str('AI_BUILDPC_MODEL') || str('AI_MODEL'),
  // Mức vượt ngân sách chấp nhận được (0.05 = 5%): "15 triệu" thường hiểu là khoảng 15 triệu, không phải trần cứng.
  buildPcBudgetTolerance: Math.min(0.2, Math.max(0, Number.parseFloat(process.env.AI_BUILDPC_BUDGET_TOLERANCE) || 0.05)),
  // Riêng bản "Hiệu năng cao" được phép vượt ngân sách tối đa bao nhiêu (0.3 = 30%).
  buildPcPerfOver: Math.min(1, Math.max(0, Number.parseFloat(process.env.AI_BUILDPC_PERF_OVER) || 0.3)),
  // Mức suy nghĩ của chatbot (Anthropic): low | medium | high | xhigh | max. Để trống = mặc định của model.
  chatEffort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(str('AI_CHAT_EFFORT').toLowerCase()) ? str('AI_CHAT_EFFORT').toLowerCase() : '',
  // AI_BUILDPC_THINKING=off: tắt hẳn suy nghĩ ở mọi lần gọi Build PC (nhanh hơn, ổn định hơn, nhưng ít "nghĩ" hơn). Mặc định bật.
  buildPcThinkingOff: str('AI_BUILDPC_THINKING').toLowerCase() === 'off',
  // Mức suy nghĩ của model cho Build PC (chỉ Anthropic): low | medium | high | xhigh | max. Để trống = mặc định của model.
  buildPcEffort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(str('AI_BUILDPC_EFFORT').toLowerCase()) ? str('AI_BUILDPC_EFFORT').toLowerCase() : '',

  ragEnabled: flag('RAG_ENABLED'),
  vectorStoreProvider: str('VECTOR_STORE_PROVIDER').toLowerCase(),
  embeddingProvider: str('EMBEDDING_PROVIDER').toLowerCase(),

  // Operational limits — enforced regardless of which provider ends up wired in.
  chatMessageMaxLength: Math.max(1, Number.parseInt(process.env.AI_CHAT_MAX_LENGTH, 10) || 2000),
  chatRateLimitPerHour: Math.max(1, Number.parseInt(process.env.AI_CHAT_RATE_LIMIT_PER_HOUR, 10) || 60),
  providerTimeoutMs: Math.max(1000, Number.parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 30_000),
  // Tổng thời gian tối đa cho một lượt AI Build PC (gồm nhiều vòng gọi model).
  buildPcTimeoutMs: Math.max(1000, Number.parseInt(process.env.AI_BUILDPC_TIMEOUT_MS, 10) || 90_000),
});

// A provider name is only "configured" once a known provider is named AND a
// model is picked AND the master switch is on. Naming an unsupported value
// in AI_PROVIDER is treated as not configured, not as a silent fallback.
export function isChatConfigured() {
  return aiConfig.enabled && SUPPORTED_AI_PROVIDERS.has(aiConfig.provider) && aiConfig.model.length > 0;
}

export function isRagConfigured() {
  return aiConfig.ragEnabled
    && SUPPORTED_VECTOR_STORES.has(aiConfig.vectorStoreProvider)
    && SUPPORTED_EMBEDDING_PROVIDERS.has(aiConfig.embeddingProvider);
}

// Shape returned by GET /api/ai/status — deliberately only booleans, never
// the provider name, model, or anything else that reveals internal setup.
export function getAiStatus() {
  return {
    enabled: aiConfig.enabled,
    chatAvailable: isChatConfigured(),
    ragAvailable: isRagConfigured(),
    buildPcAvailable: aiConfig.enabled && SUPPORTED_AI_PROVIDERS.has(aiConfig.buildPcProvider) && aiConfig.buildPcModel.length > 0,
  };
}
