import { AIProvider } from './aiProvider.interface.js';
import { aiConfig } from '../config/ai.config.js';

export class AnthropicProvider extends AIProvider {
  #apiKey;
  #model;

  constructor({ apiKey, model } = {}) {
    super();
    this.#apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!this.#apiKey) throw new Error('ANTHROPIC_API_KEY is required for AnthropicProvider.');
    this.#model = model || aiConfig.model;
  }

  get name() { return 'anthropic'; }

  async complete(request) {
    const { messages, tools, maxTokens, temperature, signal } = request;
    const { system, converted } = this.#convertMessages(messages);

    const body = {
      model: this.#model,
      max_tokens: maxTokens || 1024,
      messages: converted,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const timeoutMs = aiConfig.providerTimeoutMs;
    const ctrl = signal ? null : new AbortController();
    const effectiveSignal = signal || ctrl?.signal;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

    let data;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.#apiKey,
          'anthropic-version': '2023-06-01',
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
        const timeout = new Error(`Anthropic không phản hồi trong ${timeoutMs / 1000}s.`);
        timeout.statusCode = 504;
        throw timeout;
      }
      if (err.statusCode) throw err;
      const wrapped = new Error(`Anthropic API lỗi: ${err.message}`);
      wrapped.statusCode = 502;
      throw wrapped;
    } finally {
      if (timer) clearTimeout(timer);
    }

    let content = '';
    const toolCalls = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      _rawModelContent: data.content,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
      } : undefined,
    };
  }

  async *stream(request) {
    const { messages, tools, maxTokens, temperature } = request;
    const { system, converted } = this.#convertMessages(messages);

    const body = {
      model: this.#model,
      max_tokens: maxTokens || 1024,
      messages: converted,
      stream: true,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.#apiKey,
        'anthropic-version': '2023-06-01',
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
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') break;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const delta = event.delta.text || '';
            fullText += delta;
            yield { delta };
          }
        } catch { /* skip malformed */ }
      }
    }

    yield { done: true, content: fullText, finishReason: 'stop' };
  }

  async healthCheck() {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.#apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.#model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true, model: this.#model };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  #convertMessages(messages) {
    let system = '';
    const converted = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id || `toolu_${Date.now()}_${content.length}`,
            name: tc.name,
            input: tc.arguments,
          });
        }
        converted.push({ role: 'assistant', content });
        continue;
      }

      if (msg.role === 'tool') {
        const lastMsg = converted[converted.length - 1];
        const toolUseId = msg.toolCallId || this.#findToolUseId(converted, msg.name);
        const block = {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: msg.content,
        };
        if (lastMsg?.role === 'user') {
          lastMsg.content.push(block);
        } else {
          converted.push({ role: 'user', content: [block] });
        }
        continue;
      }

      converted.push({ role: msg.role, content: msg.content });
    }

    return { system, converted };
  }

  #findToolUseId(converted, toolName) {
    for (let i = converted.length - 1; i >= 0; i--) {
      const msg = converted[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const block = msg.content.find(b => b.type === 'tool_use' && b.name === toolName);
        if (block) return block.id;
      }
    }
    return `toolu_${Date.now()}`;
  }

  #handleHttpError(status, body) {
    if (status === 429) {
      const err = new Error('Hệ thống AI đang tải cao. Vui lòng thử lại sau ít phút.');
      err.statusCode = 429;
      err.code = 'AI_RATE_LIMITED';
      err.retryAfterMs = 60_000;
      throw err;
    }
    if (status === 401) {
      const err = new Error('Anthropic API key không hợp lệ.');
      err.statusCode = 502;
      throw err;
    }
    if (status === 400) {
      let msg = 'Anthropic API lỗi request.';
      try { const parsed = JSON.parse(body); msg = parsed.error?.message || msg; } catch {}
      const err = new Error(msg);
      err.statusCode = 400;
      throw err;
    }
    const err = new Error(`Anthropic API lỗi (HTTP ${status}).`);
    err.statusCode = 502;
    throw err;
  }
}
