// AI Provider contract. Every concrete provider (OpenAI, Gemini, a future
// Python AI Service reached over HTTP) implements this same shape, so
// aiChat.service never branches on "which provider" — it only ever talks to
// an AIProvider. This is the seam the architecture promises: adding a real
// provider later means writing one adapter class here, not touching the
// orchestration layer.
export class AIProvider {
  /** @returns {string} stable id used in logs/config, e.g. 'openai', 'gemini', 'python' */
  get name() { throw new NotImplementedError(this, 'name'); }

  /**
   * Non-streaming chat completion.
   * @param {{ messages: {role: 'system'|'user'|'assistant'|'tool', content: string}[],
   *           tools?: object[], maxTokens?: number, temperature?: number, signal?: AbortSignal }} request
   * @returns {Promise<{ content: string, toolCalls?: object[], finishReason: string, usage?: { promptTokens: number, completionTokens: number } }>}
   */
  async complete(_request) { throw new NotImplementedError(this, 'complete'); }

  /**
   * Streaming chat completion. Yields incremental text deltas, then a final
   * event carrying the same shape complete() resolves with. Consumers that
   * don't need streaming can just drain the generator and keep the last value.
   * @param {Parameters<AIProvider['complete']>[0]} request
   * @returns {AsyncGenerator<{ delta: string } | { done: true, content: string, toolCalls?: object[], finishReason: string }>}
   */
  async *stream(_request) { throw new NotImplementedError(this, 'stream'); }

  /** Cheap reachability/credential check — must never throw, only report. */
  async healthCheck() { throw new NotImplementedError(this, 'healthCheck'); }
}

export class NotImplementedError extends Error {
  constructor(provider, method) {
    super(`${provider?.constructor?.name ?? 'AIProvider'}.${method}() is not implemented.`);
    this.name = 'NotImplementedError';
  }
}

// Returned by aiChat.service whenever no real provider is configured
// (AI_ENABLED=false, or AI_PROVIDER/AI_MODEL unset). It satisfies the
// AIProvider contract so call sites never need an "is this a real provider"
// branch — they call .complete()/.stream() and get a clearly-labeled error
// instead of a fake answer.
export class UnavailableProvider extends AIProvider {
  get name() { return 'unavailable'; }

  async complete() {
    throw providerUnavailableError();
  }

  // eslint-disable-next-line require-yield
  async *stream() {
    throw providerUnavailableError();
  }

  async healthCheck() {
    return { ok: false, reason: 'AI provider is not configured.' };
  }
}

export function providerUnavailableError() {
  const error = new Error('Tính năng trò chuyện AI chưa khả dụng.');
  error.statusCode = 501;
  error.code = 'AI_PROVIDER_UNAVAILABLE';
  return error;
}
