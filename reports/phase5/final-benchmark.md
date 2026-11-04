# DUCMANH PC — Phase 5: Final Benchmark Report

## 1. Giới thiệu

Báo cáo tổng hợp kết quả đánh giá AI Chatbot DUCMANH PC qua 5 Phase phát triển, so sánh **Baseline (Gemini + Function Calling)** với **Hybrid RAG (Semantic + BM25 + RRF + Function Calling)**.

### Thông tin thực nghiệm
- **Corpus:** 578 chunks, 145 documents (SHA256: `f6aee9d6ede860ea…`)
- **Benchmark:** 43 câu hỏi, 9 categories: model, SKU, Vietnamese, policy, comparison, multi-turn, routing, negative, missing
- **Model:** gemini-2.0-flash-lite (generation + judge)
- **Phương pháp:** LLM-as-Judge (RAG Triad) + deterministic metrics

## 2. Tổng hợp Phase 1–5

### Phase 1: Knowledge Base & Embedding
- Xây dựng corpus 578 chunks từ 145 documents (sản phẩm + chính sách).
- Text chunking với overlap, metadata tagging.

### Phase 2: RAG Integration
- Tích hợp Hybrid Retrieval (Semantic + BM25 + RRF) vào chatbot.
- Function Calling cho giá, tồn kho, đơn hàng.

### Phase 3: Multi-turn RAG & Query Routing
- **Retrieval metrics (offline, mock embeddings):**

| Metric | Before | After | Δ |
|---|---|---|---|
| Recall@5 | 0.7794 | 1.0000 | +0.2206 |
| MRR@5 | 0.5931 | 1.0000 | +0.4069 |
| nDCG@5 | 0.6291 | 1.0000 | +0.3709 |
| Routing Accuracy | 65.1% | 100.0% | 34.9% |

### Phase 4: RAG Triad Evaluation (Live Gemini API)

| Tiêu chí | Baseline (FC only) | Hybrid RAG + FC | Δ |
|---|---|---|---|
| **Context Relevance** | N/A (n=0) | **0.7921** (n=34) | — |
| **Groundedness** | 0.2247 (n=34) | **0.7574** (n=27) | **+0.5327** |
| **Answer Relevance** | 0.9581 (n=43) | 0.9349 (n=43) | -0.0232 |
| **Hallucination Rate** | 55.1% | **21.6%** | **-33.5%** |

### Phase 5: Final Verification
- 86/86 live evaluation records, 0 errors sau retry.
- All regression tests PASS.
- Production verification tests PASS.

## 3. Phân tích theo nhóm câu hỏi

| Category | N | RAG CR | BL GR | RAG GR | BL AR | RAG AR |
|---|---|---|---|---|---|---|
| model | 8 | 0.8325 | 0.4900 | 1.0000 | 0.9750 | 0.9250 |
| sku | 6 | 1.0000 | 0.2083 | 0.9760 | 1.0000 | 1.0000 |
| vietnamese | 4 | 0.6900 | 0.1250 | 1.0000 | 1.0000 | 0.9500 |
| policy | 4 | 0.7200 | 0.0000 | 1.0000 | 1.0000 | 1.0000 |
| comparison | 4 | 0.8375 | 0.0000 | N/A | 1.0000 | 0.8500 |
| multi_turn | 7 | 0.5440 | 0.3500 | 0.7067 | 0.9143 | 0.8857 |
| routing | 5 | 0.8533 | 0.3000 | 0.5000 | 0.8800 | 0.8800 |
| negative | 3 | N/A | 0.0000 | 0.0000 | 0.8667 | 1.0000 |
| missing | 2 | N/A | 0.1500 | 0.1650 | 1.0000 | 1.0000 |


## 4. Kết luận

### Hybrid RAG mang lại cải thiện đáng kể:
1. **Groundedness tăng +53.3%** (0.22 → 0.76) — câu trả lời có bằng chứng từ dữ liệu thực.
2. **Hallucination Rate giảm 33.5%** (55.1% → 21.6%) — giảm đáng kể thông tin bịa đặt.
3. **Retrieval hoàn hảo:** Recall@5 = 1.0, MRR@5 = 1.0, Routing = 100%.
4. **Answer Relevance ổn định:** -0.02 (0.96 → 0.93) — chấp nhận được, RAG đôi khi quá chi tiết.

### Điểm mạnh nổi bật:
- **SKU queries:** Groundedness 0.21 → **0.98** — gần hoàn hảo.
- **Policy queries:** Groundedness 0.00 → **1.00** — cải thiện tuyệt đối.
- **Vietnamese accent:** Groundedness 0.13 → **1.00** — BM25 accent folding hiệu quả.

### Hạn chế và hướng phát triển:
- Multi-turn context relevance (0.54) — cần cải thiện query rewriting.
- Mock embeddings — cần đánh giá với real Gemini embeddings.
- Sample size 43 queries — đủ cho A/B comparison, chưa đủ cho statistical significance testing.
- Latency tăng ~2x với RAG (8.4s → 15.3s median) do thêm retrieval + context.

## 5. Dữ liệu nguồn

| File | Nội dung | Source |
|---|---|---|
| `reports/phase3/benchmark.json` | Retrieval metrics (Recall, MRR, nDCG) | Phase 3 offline benchmark |
| `reports/phase4/live/evaluation.json` | 86 RAG Triad evaluation records | Phase 4 live Gemini API |
| `reports/phase4/mock/evaluation.json` | 86 mock pipeline verification records | Phase 4 mock mode |
| `reports/phase5/metrics.json` | Structured metrics compilation | Phase 5 (this report) |
| `reports/phase5/comparison.csv` | Paired Baseline/RAG per query | Phase 5 |
| `reports/phase5/failure-analysis.md` | Low-score analysis | Phase 5 |
| `reports/phase5/performance.md` | Latency, tokens, API calls | Phase 5 |
