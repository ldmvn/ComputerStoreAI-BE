import { AIProvider } from './aiProvider.interface.js';
import { aiConfig } from '../config/ai.config.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider extends AIProvider {
  #apiKey;
  #model;
  #baseUrl;

  constructor({ apiKey, model, baseUrl } = {}) {
    super();
    this.#apiKey = apiKey || process.env.OPENROUTER_API_KEY;
    if (!this.#apiKey) throw new Error('OPENROUTER_API_KEY is required for OpenRouterProvider.');
    this.#model = model || aiConfig.model;
    this.#baseUrl = baseUrl || OPENROUTER_BASE;
  }

  get name() { return 'openrouter'; }

  async complete(request) {
    const { messages, tools, maxTokens, temperature, signal } = request;

    const body = {
      model: this.#model,
      messages: this.#convertMessages(messages),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    if (tools?.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const timeoutMs = aiConfig.providerTimeoutMs;
    const ctrl = signal ? null : new AbortController();
    const effectiveSignal = signal || ctrl?.signal;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

    let data;
    try {
      const res = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
          'HTTP-Referer': process.env.CORS_ORIGIN || 'http://localhost:3000',
          'X-Title': 'DUCMANH PC',
        },
        body: JSON.stringify(body),
        signal: effectiveSignal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        this.#handleHttpError(res.status, errBody);
      }

      data = await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeout = new Error(`OpenRouter không phản hồi trong ${timeoutMs / 1000}s.`);
        timeout.statusCode = 504;
        throw timeout;
      }
      if (err.statusCode) throw err;
      const wrapped = new Error(`OpenRouter API lỗi: ${err.message}`);
      wrapped.statusCode = 502;
      throw wrapped;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const choice = data.choices?.[0];
    const message = choice?.message || {};
    let toolCalls = message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
    }));

    let content = message.content || '';

    if (!toolCalls?.length && content) {
      const parsed = this.#extractToolCallsFromText(content);
      if (parsed.toolCalls.length) {
        toolCalls = parsed.toolCalls;
        content = parsed.cleanedText;
      }
    }

    return {
      content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
      } : undefined,
    };
  }

  async *stream(request) {
    const { messages, tools, maxTokens, temperature } = request;

    const body = {
      model: this.#model,
      messages: this.#convertMessages(messages),
      stream: true,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    if (tools?.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#apiKey}`,
        'HTTP-Referer': process.env.CORS_ORIGIN || 'http://localhost:3000',
        'X-Title': 'DUCMANH PC',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.#handleHttpError(res.status, errBody);
    }

    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            yield { delta };
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    yield { done: true, content: fullText, finishReason: 'stop' };
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.#model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true, model: this.#model };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  #convertMessages(messages) {
    let pendingToolCalls = [];
    const converted = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const calls = msg.toolCalls.map((tc, i) => ({
          id: tc.id || `call_${i}_${Date.now()}`,
          name: tc.name,
          arguments: tc.arguments,
        }));
        pendingToolCalls = [...calls];
        converted.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else if (msg.role === 'tool') {
        const idx = pendingToolCalls.findIndex(tc => tc.name === msg.name);
        const callId = idx >= 0 ? pendingToolCalls.splice(idx, 1)[0].id : msg.name;
        converted.push({ role: 'tool', tool_call_id: callId, content: msg.content });
      } else {
        converted.push({ role: msg.role, content: msg.content });
      }
    }
    return converted;
  }

  #extractToolCallsFromText(text) {
    const toolCalls = [];
    let cleanedText = text;

    // Pattern 1: <tool_call>funcName{"key":"value"}</tool_call>
    const p1 = /<tool_call>\s*(\w+)\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
    let m;
    while ((m = p1.exec(text)) !== null) {
      try {
        toolCalls.push({ id: `call_${Date.now()}_${toolCalls.length}`, name: m[1], arguments: JSON.parse(m[2]) });
      } catch {}
    }

    // Pattern 2: DeepSeek DSML XML format
    const p2 = /name="(\w+)"[\s\S]*?<[^>]*parameter\s+name="(\w+)"[^>]*>([^<]*)</g;
    while ((m = p2.exec(text)) !== null) {
      const existing = toolCalls.find(tc => tc.name === m[1]);
      if (existing) {
        existing.arguments[m[2]] = m[3];
      } else {
        toolCalls.push({ id: `call_${Date.now()}_${toolCalls.length}`, name: m[1], arguments: { [m[2]]: m[3] } });
      }
    }

    // Pattern 3: ```json {"name":"func","arguments":{...}} ```
    const p3 = /```(?:json)?\s*\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\s*```/g;
    while ((m = p3.exec(text)) !== null) {
      try {
        toolCalls.push({ id: `call_${Date.now()}_${toolCalls.length}`, name: m[1], arguments: JSON.parse(m[2]) });
      } catch {}
    }

    if (toolCalls.length) {
      cleanedText = text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/<[^>]*DSML[^>]*>[\s\S]*?<\/[^>]*DSML[^>]*>/g, '')
        .replace(/```(?:json)?\s*\{\s*"name"[\s\S]*?\}\s*```/g, '')
        .trim();

      for (const tc of toolCalls) {
        for (const [k, v] of Object.entries(tc.arguments)) {
          const num = Number(v);
          if (typeof v === 'string' && !isNaN(num) && v.trim() !== '') tc.arguments[k] = num;
        }
      }
    }

    return { toolCalls, cleanedText };
  }

  #handleHttpError(status, body) {
    if (status === 429) {
      const msg = body.toLowerCase?.() || '';
      let type = 'UNKNOWN', retryAfterMs = 60_000, userMessage = 'Hệ thống AI đang tải cao. Vui lòng thử lại sau ít phút.';
      if (msg.includes('daily') || msg.includes('per day')) {
        type = 'RPD'; retryAfterMs = 0; userMessage = 'Đã hết giới hạn request trong ngày. Vui lòng thử lại sau 24h.';
      } else if (msg.includes('per minute') || msg.includes('rpm')) {
        type = 'RPM'; userMessage = 'Vượt giới hạn request/phút. Vui lòng thử lại sau 1 phút.';
      }
      const err = new Error(userMessage);
      err.statusCode = 429;
      err.code = 'AI_RATE_LIMITED';
      err.rateLimitType = type;
      err.retryAfterMs = retryAfterMs;
      throw err;
    }
    if (status === 401 || status === 403) {
      const err = new Error('OpenRouter API key không hợp lệ hoặc không có quyền truy cập.');
      err.statusCode = 502;
      throw err;
    }
    if (status === 402) {
      const err = new Error('Tài khoản OpenRouter hết credit. Vui lòng nạp thêm tại openrouter.ai.');
      err.statusCode = 402;
      err.code = 'AI_CREDITS_EXHAUSTED';
      throw err;
    }
    const err = new Error(`OpenRouter API lỗi (HTTP ${status}).`);
    err.statusCode = 502;
    throw err;
  }
}
