// Phase 4 Evaluation Engine
// Orchestrates: query → retrieval → response generation → triad scoring.
// Supports mock/offline mode, checkpoint/resume, rate limiting.

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalConfig, loadCorpus } from './config.mjs';
import { dataset } from '../phase3.dataset.mjs';
import { BM25Index } from '../../../src/ai/rag/retrieval/bm25.js';
import { HybridRetriever } from '../../../src/ai/rag/retrieval/hybridRetriever.js';
import { classifyQuery } from '../../../src/ai/rag/routing/queryRouter.js';
import { rewriteQuery } from '../../../src/ai/rag/routing/conversationContext.js';
import { buildContext, contextBudget, estimateTokens } from '../../../src/ai/rag/context/contextBuilder.js';
import {
  deterministicContextRelevance, buildContextRelevancePrompt, parseContextRelevanceResponse, combineContextRelevance,
} from './scorers/contextRelevance.mjs';
import {
  buildExtractClaimsPrompt, parseExtractClaimsResponse,
  buildVerifyClaimsPrompt, parseVerifyClaimsResponse,
  computeGroundednessScore, checkCitationSupport,
} from './scorers/groundedness.mjs';
import {
  buildAnswerRelevancePrompt, parseAnswerRelevanceResponse, checkProductMention,
} from './scorers/answerRelevance.mjs';

const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../../../reports/phase4', import.meta.url));

function mockVector(text) {
  const vector = new Array(512).fill(0);
  const normalized = String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  for (const word of normalized.match(/[a-z0-9]+/g) || []) {
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    vector[(h >>> 0) % vector.length]++;
  }
  return vector;
}

function buildMockVectorStore(corpus) {
  const norm = v => Math.sqrt(v.reduce((s, n) => s + n * n, 0));
  const indexed = corpus.map(d => ({ ...d, vector: mockVector(d.content + ' ' + d.metadata.title) }));
  return {
    async search({ vector, topK, filter }) {
      const qNorm = norm(vector);
      return indexed
        .filter(d => !filter || Object.entries(filter).every(([k, v]) => d.metadata[k] === v))
        .map(d => ({ ...d, score: d.vector.reduce((s, n, i) => s + n * vector[i], 0) / (norm(d.vector) * qNorm || 1) }))
        .sort((a, b) => b.score - a.score).slice(0, topK);
    }
  };
}

// Mock LLM for offline testing
function createMockJudge() {
  return {
    async complete({ messages }) {
      const userMsg = messages.find(m => m.role === 'user')?.content || '';
      // Return plausible mock scores for testing the pipeline
      if (userMsg.includes('relevance of the retrieved context')) {
        return { content: JSON.stringify({ score: 0.75, chunkRatings: [], summary: 'Mock: mostly relevant context.' }), usage: { promptTokens: 100, completionTokens: 50 } };
      }
      if (userMsg.includes('Extract all factual claims')) {
        return { content: JSON.stringify({ claims: [{ id: 1, text: 'Mock claim about product specs', type: 'spec' }] }), usage: { promptTokens: 100, completionTokens: 50 } };
      }
      if (userMsg.includes('fact-checker')) {
        return { content: JSON.stringify({ verdicts: [{ claimId: 1, verdict: 'supported', score: 1, evidence: 'mock', reason: 'mock verification' }] }), usage: { promptTokens: 100, completionTokens: 50 } };
      }
      if (userMsg.includes('Evaluate the response')) {
        return { content: JSON.stringify({ score: 0.8, correctProduct: true, completeness: 'high', issues: [], summary: 'Mock: good response.' }), usage: { promptTokens: 100, completionTokens: 50 } };
      }
      // Generator: produce a mock chatbot response
      return { content: 'Đây là câu trả lời mẫu cho mục đích kiểm thử. Thông số sản phẩm mock.', usage: { promptTokens: 100, completionTokens: 50 } };
    }
  };
}

function buildSystemPrompt(ragContext, hasRag) {
  const base = `Bạn là trợ lý mua sắm AI của DUCMANH PC — cửa hàng linh kiện máy tính tại Việt Nam.
Quy tắc: Trả lời tiếng Việt, ngắn gọn, chính xác. Không bịa thông số. Nếu thiếu dữ liệu, nói rõ.`;
  if (!hasRag || !ragContext) return base;
  return `${base}\n\nTài liệu tham khảo:\n${ragContext}`;
}

async function withRetry(fn, config = evalConfig) {
  let lastErr;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.statusCode === 429 || err.code === 'AI_RATE_LIMITED') {
        const delay = config.retryBaseDelayMs * (attempt + 1);
        console.warn(`[Eval] Rate limited (attempt ${attempt + 1}/${config.maxRetries}), waiting ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export class EvaluationEngine {
  #provider;
  #judge;
  #corpus;
  #corpusSha;
  #vectorStore;
  #bm25;
  #retriever;
  #embeddingProvider;
  #mode; // 'live' | 'mock'
  #metrics;

  #reportsDir;

  constructor({ provider, judge, mode = 'mock', reportsDir } = {}) {
    this.#mode = mode;
    this.#reportsDir = reportsDir || DEFAULT_REPORTS_DIR;
    if (mode === 'mock') {
      this.#provider = createMockJudge();
      this.#judge = createMockJudge();
    } else {
      this.#provider = provider;
      this.#judge = judge || provider;
    }
    this.#metrics = { geminiCalls: 0, embeddingCalls: 0, promptTokens: 0, completionTokens: 0, errors: 0 };
  }

  async initialize() {
    const { corpus, sha256 } = await loadCorpus();
    this.#corpus = corpus;
    this.#corpusSha = sha256;
    this.#vectorStore = buildMockVectorStore(corpus);
    this.#bm25 = new BM25Index();
    this.#bm25.build(corpus);
    let embCalls = 0;
    this.#embeddingProvider = { embedQuery: async query => { embCalls++; this.#metrics.embeddingCalls++; return mockVector(query); } };
    this.#retriever = new HybridRetriever({ embeddingProvider: this.#embeddingProvider, vectorStore: this.#vectorStore, bm25Index: this.#bm25 });
    return { chunks: corpus.length, documents: new Set(corpus.map(d => (d.metadata?.documentId || d.id).split('::')[0])).size, sha256 };
  }

  async #callLLM(provider, messages, { maxTokens, temperature } = {}) {
    const result = await withRetry(() => provider.complete({
      messages,
      maxTokens: maxTokens || evalConfig.maxTokensJudge,
      temperature: temperature ?? evalConfig.temperatureJudge,
    }));
    this.#metrics.geminiCalls++;
    this.#metrics.promptTokens += result.usage?.promptTokens || 0;
    this.#metrics.completionTokens += result.usage?.completionTokens || 0;
    if (this.#mode === 'live') await delay(evalConfig.rateLimitDelayMs);
    return result.content;
  }

  // Run retrieval for a single dataset item
  async retrieve(item, { useRag = true } = {}) {
    const start = performance.now();
    const resolved = rewriteQuery(item.query, item.history || []);
    const routing = classifyQuery(item.query, { resolved });
    const ragEnabled = useRag && ['rag_only', 'rag_and_fc'].includes(routing.route);
    const diagnostics = {};
    const results = ragEnabled
      ? await this.#retriever.retrieve({
          query: resolved.query, topK: evalConfig.topK, diagnostics,
          filter: routing.features.policy && !routing.features.model ? { sourceType: 'policy_page' } : undefined,
        })
      : [];
    const context = ragEnabled
      ? buildContext(results, { query: resolved.query, tokenBudget: contextBudget(routing.complexity) })
      : { contextText: '', citations: [], hasContext: false, chunks: [] };
    return {
      resolved, routing, results, context,
      latencyMs: performance.now() - start,
      embeddingCalls: diagnostics.embeddingCalls || 0,
    };
  }

  // Generate AI response for a single item
  async generateResponse(item, retrieval, { useRag = true } = {}) {
    const start = performance.now();
    const messages = [
      { role: 'system', content: buildSystemPrompt(retrieval.context.contextText, useRag && retrieval.context.hasContext) },
      { role: 'user', content: retrieval.resolved.query },
    ];
    const response = await this.#callLLM(this.#provider, messages, {
      maxTokens: evalConfig.maxTokensGenerator,
      temperature: evalConfig.temperatureGenerator,
    });
    return { response, latencyMs: performance.now() - start };
  }

  // Score Context Relevance
  async scoreContextRelevance(item, retrieval) {
    const det = deterministicContextRelevance(retrieval.results, item.relevant);
    let llm = null;
    if (retrieval.context.contextText && retrieval.results.length > 0) {
      const prompt = buildContextRelevancePrompt(item.query, retrieval.context.contextText);
      const raw = await this.#callLLM(this.#judge, [{ role: 'user', content: prompt }]);
      llm = parseContextRelevanceResponse(raw);
    }
    return combineContextRelevance(det, llm);
  }

  // Score Groundedness
  async scoreGroundedness(item, retrieval, response) {
    if (!response) return { score: null, reason: 'no_response' };
    // Step 1: Extract claims
    const extractPrompt = buildExtractClaimsPrompt(item.query, response);
    const extractRaw = await this.#callLLM(this.#judge, [{ role: 'user', content: extractPrompt }]);
    const { claims } = parseExtractClaimsResponse(extractRaw);
    if (!claims.length) return { score: null, reason: 'no_claims_extracted', claimCount: 0 };

    // Step 2: Verify claims
    const verifyPrompt = buildVerifyClaimsPrompt(claims, retrieval.context.contextText, []);
    const verifyRaw = await this.#callLLM(this.#judge, [{ role: 'user', content: verifyPrompt }]);
    const { verdicts } = parseVerifyClaimsResponse(verifyRaw);

    const result = computeGroundednessScore(claims, verdicts);
    const citationCheck = checkCitationSupport(response, retrieval.context.citations);
    return { ...result, citationSupport: citationCheck };
  }

  // Score Answer Relevance
  async scoreAnswerRelevance(item, retrieval, response) {
    if (!response) return { score: null, reason: 'no_response' };
    const prompt = buildAnswerRelevancePrompt(item.query, response, item.history);
    const raw = await this.#callLLM(this.#judge, [{ role: 'user', content: prompt }]);
    const parsed = parseAnswerRelevanceResponse(raw);
    const productCheck = checkProductMention(response, item.relevant, retrieval.results);
    return { ...parsed, productMention: productCheck };
  }

  // Evaluate a single item end-to-end
  async evaluateItem(item, { useRag = true, skipResponse = false } = {}) {
    const retrieval = await this.retrieve(item, { useRag });
    let response = null, responseLatency = 0;
    if (!skipResponse) {
      const gen = await this.generateResponse(item, retrieval, { useRag });
      response = gen.response;
      responseLatency = gen.latencyMs;
    }
    const hasRetrieval = useRag && retrieval.results.length > 0;
    const contextRelevance = hasRetrieval ? await this.scoreContextRelevance(item, retrieval) : { score: null, reason: 'no_retrieval' };
    const groundedness = response ? await this.scoreGroundedness(item, retrieval, response) : { score: null, reason: 'no_response' };
    const answerRelevance = response ? await this.scoreAnswerRelevance(item, retrieval, response) : { score: null, reason: 'no_response' };

    return {
      id: item.id,
      category: item.category,
      query: item.query,
      expectedRoute: item.route,
      routing: retrieval.routing,
      useRag,
      rewrittenQuery: retrieval.resolved.query,
      retrievedChunks: retrieval.results.length,
      contextTokens: estimateTokens(retrieval.context.contextText),
      retrievalLatencyMs: retrieval.latencyMs,
      response,
      responseLatencyMs: responseLatency,
      totalLatencyMs: retrieval.latencyMs + responseLatency,
      evaluation: { contextRelevance, groundedness, answerRelevance },
    };
  }

  // Run full evaluation on the dataset
  async run({ useRag = true, items = null, checkpoint = true } = {}) {
    const toEval = items || dataset;
    const label = useRag ? 'rag' : 'baseline';
    const checkpointPath = join(this.#reportsDir, `${label}-${evalConfig.checkpointFile}`);
    await mkdir(this.#reportsDir, { recursive: true });

    // Load checkpoint
    const completed = new Set();
    const results = [];
    if (checkpoint) {
      try {
        const lines = (await readFile(checkpointPath, 'utf8')).trim().split('\n').filter(Boolean);
        for (const line of lines) {
          const r = JSON.parse(line);
          completed.add(r.id);
          results.push(r);
        }
        console.log(`[Eval] Resumed ${completed.size} items from checkpoint.`);
      } catch { /* no checkpoint */ }
    }

    for (const item of toEval) {
      if (completed.has(item.id)) continue;
      try {
        console.log(`[Eval][${label}] ${item.id}: ${item.query}`);
        const result = await this.evaluateItem(item, { useRag });
        results.push(result);
        completed.add(item.id);
        if (checkpoint) {
          await appendFile(checkpointPath, JSON.stringify(result) + '\n');
        }
      } catch (err) {
        this.#metrics.errors++;
        console.error(`[Eval] Error on ${item.id}:`, err.message);
        if (err.statusCode === 429 && err.rateLimitType === 'RPD') {
          console.error('[Eval] Daily quota exhausted. Saving checkpoint and stopping.');
          break;
        }
        results.push({
          id: item.id, category: item.category, query: item.query, useRag,
          error: err.message, evaluation: { contextRelevance: null, groundedness: null, answerRelevance: null },
        });
        if (checkpoint) {
          await appendFile(checkpointPath, JSON.stringify(results[results.length - 1]) + '\n');
        }
      }
    }

    return { results, metrics: { ...this.#metrics }, corpusSha: this.#corpusSha, mode: this.#mode, label };
  }

  get metrics() { return { ...this.#metrics }; }
}
