#!/usr/bin/env node
/**
 * RAG Triad Evaluation Runner
 *
 * Chạy bộ test cases qua chatbot thật, thu thập context + answer,
 * rồi dùng LLM-as-Judge chấm điểm RAG Triad.
 *
 * Usage:
 *   node src/ai/rag/evaluation/runEvaluation.js
 *   node src/ai/rag/evaluation/runEvaluation.js --cases prod-01,tech-01
 *   node src/ai/rag/evaluation/runEvaluation.js --category product
 */

import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChatService } from '../../services/aiChat.service.js';
import { TEST_CASES } from './testCases.js';
import { evaluateBatch, formatReport } from './ragTriad.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function collectResults(chatService, testCases) {
  const results = [];

  for (const tc of testCases) {
    console.log(`\n[Runner] Testing: ${tc.id} — "${tc.query}"`);
    try {
      const response = await chatService(
        { message: tc.query, conversationId: `eval-${tc.id}` },
        { userId: null },
      );

      const ragContext = response._context?.ragContextText || '';
      const contextFromCitations = response.citations?.length
        ? response.citations.map((c, i) => `[Nguồn ${i + 1}] ${c.title}: ${c.sourceRef}`).join('\n')
        : '';
      const toolContext = (response.toolCalls || [])
        .map(tc => `[Tool: ${tc.name}] ${JSON.stringify(tc.result).slice(0, 500)}`)
        .join('\n');

      results.push({
        id: tc.id,
        query: tc.query,
        category: tc.category,
        context: ragContext || contextFromCitations || toolContext || '(không có context)',
        answer: response.reply,
        toolCalls: response.toolCalls || [],
        routing: response._routing,
        metrics: response._metrics,
      });

      console.log(`[Runner] ${tc.id}: reason=${response._routing?.reason || response._routing?.route}, tools=${response.toolCalls?.length || 0}, reply=${response.reply.slice(0, 80)}...`);
    } catch (err) {
      console.error(`[Runner] ${tc.id} FAILED:`, err.message);
      results.push({
        id: tc.id,
        query: tc.query,
        category: tc.category,
        context: '',
        answer: `ERROR: ${err.message}`,
        toolCalls: [],
        error: err.message,
      });
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let filterIds = null;
  let filterCategory = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cases' && args[i + 1]) filterIds = args[++i].split(',');
    if (args[i] === '--category' && args[i + 1]) filterCategory = args[++i];
  }

  let cases = TEST_CASES;
  if (filterIds) cases = cases.filter(tc => filterIds.includes(tc.id));
  if (filterCategory) cases = cases.filter(tc => tc.category === filterCategory);

  if (!cases.length) {
    console.error('Không có test case nào phù hợp.');
    process.exit(1);
  }

  console.log(`\n[RAG Triad Evaluation] Bắt đầu đánh giá ${cases.length} test cases...`);
  console.log('═'.repeat(50));

  // Bootstrap AI services (RAG + providers)
  console.log('[Runner] Khởi tạo AI services...');
  const { bootstrapAI } = await import('../../bootstrap.js');
  await bootstrapAI();

  // Tạo chat service + judge provider
  const chatService = createChatService();
  const { AnthropicProvider } = await import('../../providers/anthropic.provider.js');
  let judge;
  try {
    judge = new AnthropicProvider();
  } catch {
    console.error('Không có ANTHROPIC_API_KEY cho LLM-as-Judge. Set trong .env');
    process.exit(1);
  }

  // Phase 1: Thu thập kết quả chatbot
  console.log('\n[Phase 1] Thu thập câu trả lời từ chatbot...');
  const results = await collectResults(chatService, cases);

  // Phase 2: LLM-as-Judge đánh giá RAG Triad
  console.log('\n[Phase 2] LLM-as-Judge đánh giá RAG Triad...');

  const report = await evaluateBatch(judge, results);

  // Phase 3: Xuất report
  console.log('\n' + formatReport(report));

  // Lưu JSON report
  const reportDir = join(__dirname, 'reports');
  await mkdir(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(reportDir, `triad-${timestamp}.json`);
  const textPath = join(reportDir, `triad-${timestamp}.txt`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(textPath, formatReport(report));

  console.log(`\n[Done] Report saved:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Text: ${textPath}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
