import { GoogleGenAI } from '@google/genai';
import { AIProvider } from './aiProvider.interface.js';
import { aiConfig } from '../config/ai.config.js';

export class GeminiProvider extends AIProvider {
  #ai;
  #model;

  constructor({ apiKey, model, client } = {}) {
    super();
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is required for GeminiProvider.');
    this.#ai = client || new GoogleGenAI({ apiKey: key });
    this.#model = model || aiConfig.model;
  }

  get name() { return 'gemini'; }

  async complete(request) {
    const { messages, tools, maxTokens, temperature, signal } = request;

    let systemInstruction, contents;
    try {
      ({ systemInstruction, contents } = this.#convertMessages(messages));
    } catch (convErr) {
      const wrapped = new Error(`Gemini message conversion failed: ${convErr.message}`);
      wrapped.statusCode = 502;
      throw wrapped;
    }

    const config = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (tools?.length) {
      config.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }
    if (maxTokens) config.maxOutputTokens = maxTokens;
    if (temperature !== undefined) config.temperature = temperature;

    const timeoutMs = aiConfig.providerTimeoutMs;
    const ctrl = signal ? null : new AbortController();
    const effectiveSignal = signal || ctrl?.signal;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

    let response;
    try {
      response = await this.#ai.models.generateContent({
        model: this.#model,
        contents,
        config: { ...config, abortSignal: effectiveSignal },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeout = new Error(`Gemini không phản hồi trong ${timeoutMs / 1000}s.`);
        timeout.statusCode = 504;
        throw timeout;
      }
      this.#handleApiError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const textParts = parts.filter(p => p.text).map(p => p.text);
    const text = textParts.join('');
    const fcParts = parts.filter(p => p.functionCall);
    const toolCalls = fcParts.map(p => ({
      name: p.functionCall.name,
      arguments: p.functionCall.args || {},
    }));

    const result = {
      content: text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        completionTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };

    if (toolCalls.length && candidate?.content) {
      result._rawModelContent = candidate.content;
    }

    return result;
  }

  async *stream(request) {
    const { messages, tools, maxTokens, temperature } = request;
    const { systemInstruction, contents } = this.#convertMessages(messages);

    const config = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (tools?.length) {
      config.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }
    if (maxTokens) config.maxOutputTokens = maxTokens;
    if (temperature !== undefined) config.temperature = temperature;

    let response;
    try {
      response = await this.#ai.models.generateContentStream({
        model: this.#model,
        contents,
        config,
      });
    } catch (err) {
      this.#handleApiError(err);
    }

    let fullText = '';
    for await (const chunk of response) {
      const delta = chunk.text ?? '';
      if (delta) {
        fullText += delta;
        yield { delta };
      }
    }

    yield { done: true, content: fullText, finishReason: 'stop' };
  }

  async healthCheck() {
    try {
      await this.#ai.models.generateContent({
        model: this.#model,
        contents: 'ping',
        config: { maxOutputTokens: 5 },
      });
      return { ok: true, model: this.#model };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  #convertMessages(messages) {
    let systemInstruction;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
        continue;
      }

      if (msg.role === 'assistant') {
        if (msg._rawModelContent) {
          contents.push(msg._rawModelContent);
        } else {
          const parts = [];
          if (msg.content) parts.push({ text: msg.content });
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
            }
          }
          if (parts.length) contents.push({ role: 'model', parts });
        }
        continue;
      }

      if (msg.role === 'tool') {
        let parsed;
        try { parsed = JSON.parse(msg.content); } catch { parsed = { raw: msg.content }; }
        const part = { functionResponse: { name: msg.name, response: parsed } };
        const last = contents[contents.length - 1];
        if (last?.role === 'user' && last.parts[0]?.functionResponse) {
          last.parts.push(part);
        } else {
          contents.push({ role: 'user', parts: [part] });
        }
        continue;
      }

      // role === 'user'
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    }

    return { systemInstruction, contents };
  }

  #handleApiError(err) {
    const status = err.status || err.httpStatusCode;
    if (status === 429) {
      const detail = this.#parseRateLimitDetail(err);
      const rateErr = new Error(detail.userMessage);
      rateErr.statusCode = 429;
      rateErr.code = 'AI_RATE_LIMITED';
      rateErr.rateLimitType = detail.type;
      rateErr.retryAfterMs = detail.retryAfterMs;
      throw rateErr;
    }
    if (status === 401 || status === 403) {
      const authErr = new Error('Gemini API key không hợp lệ hoặc không có quyền truy cập.');
      authErr.statusCode = 502;
      throw authErr;
    }
    const wrapped = new Error(`Gemini API lỗi: ${err.message}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  #parseRateLimitDetail(err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('per day') || msg.includes('per_day') || msg.includes('daily')) {
      return { type: 'RPD', retryAfterMs: 0, userMessage: 'Đã hết giới hạn số request trong ngày (RPD). Vui lòng thử lại sau 24h hoặc nâng cấp API plan.' };
    }
    if (msg.includes('token') || msg.includes('tpm')) {
      return { type: 'TPM', retryAfterMs: 60_000, userMessage: 'Vượt giới hạn token/phút (TPM). Vui lòng thử lại sau 1 phút.' };
    }
    if (msg.includes('per minute') || msg.includes('per_minute') || msg.includes('rpm')) {
      return { type: 'RPM', retryAfterMs: 60_000, userMessage: 'Vượt giới hạn request/phút (RPM). Vui lòng thử lại sau 1 phút.' };
    }
    return { type: 'UNKNOWN', retryAfterMs: 60_000, userMessage: 'Hệ thống AI đang tải cao. Vui lòng thử lại sau ít phút.' };
  }
}
