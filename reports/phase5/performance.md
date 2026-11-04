# DUCMANH PC — Phase 5: Performance Benchmark

## Môi trường đo
- **Model:** gemini-2.0-flash-lite / gemini-2.0-flash-lite
- **Corpus:** 578 chunks, 145 documents
- **Embeddings:** Mock (deterministic hash-based vectors) — không phải Gemini Embedding API
- **Rate limiting:** 4.5s giữa mỗi API call (Gemini Free Tier 15 RPM)
- **Máy đo:** Windows 11, local (không cloud/container)
- **Ngày:** 2026-10-27

## 1. Retrieval Latency (Offline, Mock Embeddings)

Đo từ Phase 3 benchmark — chỉ phản ánh thời gian index lookup + RRF fusion, không bao gồm network hay Gemini API.

| Metric | Before (Phase 2) | After (Phase 3) |
|---|---|---|
| Median | 0.96 ms | 1.44 ms |
| P95 | 1.27 ms | 2.49 ms |
| Embedding calls | 38 | 30 |

> **Lưu ý:** Latency dưới 3ms vì dùng mock embeddings (in-memory hash). Production với Gemini Embedding API sẽ thêm ~100-300ms/query cho embedding call.

## 2. End-to-End Chat Latency (Live Gemini API)

Đo từ Phase 4 Live Evaluation — bao gồm retrieval + Gemini generation + scoring.

| Metric | Baseline (n=43) | RAG (n=43) |
|---|---|---|
| Median | 8390.3 ms | 15341 ms |
| P95 | 42953.3 ms | 26863.2 ms |
| Mean | 14174 ms | 15704.6 ms |

### Response Generation Latency (Gemini call only)

| Metric | Baseline (n=43) | RAG (n=43) |
|---|---|---|
| Median | 8390.1 ms | 15326 ms |
| P95 | 42951.3 ms | 26844.9 ms |
| Mean | 14173.4 ms | 15697.4 ms |

### RAG Retrieval Latency (index lookup, no embedding network)

| Metric | Value (n=43) |
|---|---|
| Median | 6.95 ms |
| P95 | 15.21 ms |
| Mean | 7.16 ms |

## 3. API Calls & Tokens

| Metric | Baseline | RAG | Total |
|---|---|---|---|
| Gemini Generation calls | 154 | 174 | 328 |
| Embedding calls | 0 | 0 | 0 |

> **Token usage:** Gemini Free Tier API không báo cáo chi tiết prompt/completion tokens trong response. Token count hiển thị 0 vì provider trả về usage trống — đây là giới hạn của Free Tier, không phải lỗi đo.

## 4. Error & Timeout Rate

| Metric | Baseline | RAG |
|---|---|---|
| Initial errors | 7 (timeout) | 1 (503 overload) |
| After retry | 0 | 0 |
| Error rate (final) | 0% | 0% |

Tất cả 8 lỗi ban đầu đều là transient (timeout hoặc server overload) và được khôi phục qua retry với timeout 60s.

## 5. Tác động của Query Cache, SKU Exact Match và Routing

| Feature | Impact |
|---|---|
| **SKU exact match** | SKU queries bypass embedding → retrieval latency < 1ms |
| **Query routing** | Routing accuracy 100% — negative/greeting queries skip retrieval entirely (latency ~0.01ms) |
| **BM25 + Vietnamese accent folding** | Queries không dấu (ví dụ "chinh sach bao hanh") vẫn match chính xác |
| **RRF fusion** | Kết hợp semantic + lexical đạt Recall@5 = 1.0 (Phase 3) |

## 6. Giới hạn đo lường

- Latency đo trên máy local Windows, không phản ánh môi trường production (cloud, network latency).
- Mock embeddings nhanh hơn real embeddings ~100x — retrieval latency production sẽ cao hơn.
- Rate limiting 4.5s/call ảnh hưởng đến tổng thời gian batch nhưng không ảnh hưởng per-query latency.
- Gemini Free Tier có biến thiên latency lớn (p95 >> median) do shared infrastructure.
- Số mẫu: 43 queries × 2 configs = 86 data points — đủ cho so sánh A/B nhưng chưa đủ cho kết luận thống kê mạnh.
