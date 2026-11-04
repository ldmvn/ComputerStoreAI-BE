import { identifiers, normalize } from '../retrieval/text.js';
import { resolveProductQuery } from './productContext.js';

// Bounded, process-local and owner-scoped. Never retain order results or assistant prose.
export class ConversationMemory {
  #sessions = new Map();
  constructor({ ttlMs = 30 * 60_000, maxSessions = 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
  }
  #key(id, owner) { return `${owner ?? 'anonymous'}:${id}`; }
  get(id, owner) {
    const key = this.#key(id, owner);
    const session = this.#sessions.get(key);
    if (!session || Date.now() - session.at > this.ttlMs) { this.#sessions.delete(key); return []; }
    return session.turns;
  }
  remember(id, owner, turn) {
    for (const [key, value] of this.#sessions) if (Date.now() - value.at > this.ttlMs) this.#sessions.delete(key);
    const turns = [...this.get(id, owner), turn].slice(-4);
    const key = this.#key(id, owner);
    this.#sessions.delete(key);
    while (this.#sessions.size >= this.maxSessions) this.#sessions.delete(this.#sessions.keys().next().value);
    this.#sessions.set(key, { at: Date.now(), turns });
  }
}
export const conversationMemory = new ConversationMemory();

export function rewriteQuery(message, turns = [], { catalog = [] } = {}) {
  if (catalog.length || turns.at(-1)?.products?.length || turns.at(-1)?.pending?.length) return resolveProductQuery(message, turns, catalog);
  const text = String(message).trim();
  const n = normalize(text);
  const explicit = identifiers(text);
  const reference = /\b(no|con nay|con do|cai nay|cai do|san pham tren|mau tren|vua roi|ca hai|hai con|con dau|con thu [12]|con sau|con truoc)\b/.test(n);
  const elliptical = /^(con |the |vay |bao hanh|gia |co |ho tro|dung |choi |nang cap|so sanh|khac )/.test(n) && text.length < 110;
  const comparisonReference = /^(con |the |vay |so voi)/.test(n) && /\bso voi\b/.test(n);
  if ((!reference && !comparisonReference && (!elliptical || explicit.length)) || !turns.length) {
    return { query: text, rewritten: false, ambiguous: reference && !turns.length, entities: explicit, historyTurns: 0 };
  }
  // A domain change clears the referent; never reach across an unrelated turn.
  const relevant = turns.at(-1)?.entities?.length ? turns.at(-1) : null;
  if (!relevant) return { query: text, rewritten: false, ambiguous: reference, entities: explicit, historyTurns: 0 };
  let entities = relevant.entities.slice(0, 3);
  if (/\b(con dau|con thu 1|con truoc)\b/.test(n)) entities = entities.slice(0, 1);
  else if (/\b(con sau|con thu 2)\b/.test(n)) entities = entities.slice(1, 2);
  const plural = /\b(ca hai|hai con|so sanh)\b/.test(n);
  if (entities.length > 1 && !plural && !explicit.length) return { query: text, rewritten: false, ambiguous: true, entities, historyTurns: 1 };
  entities = [...new Set([...entities, ...explicit])];
  return { query: `${text}\nĐối tượng: ${entities.join('; ')}`.slice(0, 650), rewritten: true, ambiguous: false, entities, historyTurns: 1 };
}

export function extractTurnEntities({ message, toolCalls = [], citations = [], previousEntities = [] }) {
  const models = identifiers(message);
  if (models.length) return models;
  const products = toolCalls.flatMap(c => c.name === 'search_products' ? c.result?.items || [] : []);
  const names = products.length ? products.map(p => p.name) : citations.filter(c => c.productId).map(c => c.title);
  return names.length ? [...new Set(names)].slice(0, 3) : previousEntities;
}
