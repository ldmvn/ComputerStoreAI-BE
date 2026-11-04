import { aiConfig } from '../config/ai.config.js';

const ALLOWED_CONTEXTS = new Set(['general', 'product_advice', 'order_lookup', 'build_pc', 'faq']);

function chatError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * @param {{ message?: unknown, conversationId?: unknown, context?: unknown }} body
 * @returns {{ message: string, conversationId: string|null, context: string }}
 */
export function parseChatRequest(body = {}) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) throw chatError('message không được để trống.');
  if (message.length > aiConfig.chatMessageMaxLength) {
    throw chatError(`message tối đa ${aiConfig.chatMessageMaxLength} ký tự.`);
  }

  let conversationId = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    if (typeof body.conversationId !== 'string') throw chatError('conversationId phải là chuỗi hoặc null.');
    const trimmed = body.conversationId.trim();
    if (trimmed.length > 100) throw chatError('conversationId tối đa 100 ký tự.');
    // UUID-shaped only — this is a client-supplied correlation id, not a
    // trusted lookup key, so reject anything that isn't the expected shape
    // rather than passing an arbitrary string further into the system.
    if (trimmed && !/^[a-zA-Z0-9-]+$/.test(trimmed)) throw chatError('conversationId không hợp lệ.');
    conversationId = trimmed || null;
  }

  let context = 'general';
  if (body.context !== undefined && body.context !== null && body.context !== '') {
    if (typeof body.context !== 'string' || !ALLOWED_CONTEXTS.has(body.context)) {
      throw chatError(`context phải là một trong: ${[...ALLOWED_CONTEXTS].join(', ')}.`);
    }
    context = body.context;
  }

  return { message, conversationId, context };
}
