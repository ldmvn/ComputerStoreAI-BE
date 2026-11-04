# DUCMANH PC — Phase 5: Production Verification Report

## Phương pháp

Production verification sử dụng **mock/integration tests** — không gọi Gemini API. Test kiểm tra toàn bộ pipeline: Query Routing → Retrieval (BM25 + Semantic mock) → Context Building → Response Formatting, trên corpus thực (578 chunks, 145 documents).

## Kết quả kiểm thử

### 1. Product Search & Comparison (3/3 PASS)
- Truy vấn theo model name → trả đúng sản phẩm (RTX 4060 → product 252)
- Truy vấn theo SKU → ánh xạ chính xác (SEED-VGA-002 → product 253)
- So sánh 2 sản phẩm → retrieval cả hai trong top-5

### 2. Policy & Store Information (2/2 PASS)
- Chính sách bảo hành → routing `rag_only`, retrieval trả content chứa "bảo hành"
- Chính sách đổi trả → retrieval trả kết quả liên quan

### 3. Vietnamese Accent & SKU Handling (3/3 PASS)
- Query không dấu ("chinh sach bao hanh") → BM25 accent folding tìm được kết quả
- SKU viết hoa/thường (SEED-VGA-002 vs seedvga002) → cả hai trả kết quả
- Phân biệt SKU khác nhau → top-1 kết quả khác nhau

### 4. Multi-turn Context & Pronoun Resolution (2/2 PASS)
- Đại từ "nó" → resolved sang entity trước đó (RTX 4060 Ti)
- "Cả hai khác nhau thế nào?" → expanded với entities từ context

### 5. Query Routing (5/5 PASS)
| Query | Expected Route | Actual | Status |
|---|---|---|---|
| "Xin chào" | `none` | `none` | PASS |
| "Thông số RTX 4060" | `rag_only` | `rag_only` | PASS |
| "RTX 4060 giá bao nhiêu?" | `fc_only` | `fc_only` | PASS |
| "Thời tiết ở Hà Nội?" | `none` | `none` | PASS |
| "Xem đơn hàng của tôi" | `fc_only` | `fc_only` | PASS |

### 6. Context Building & Citations (3/3 PASS)
- Retrieved chunks → context text + citations array
- Empty results → `hasContext = false`, context = ""
- Token budget nhỏ → context ngắn hơn hoặc ít chunks hơn

### 7. Error Handling & Edge Cases (3/3 PASS)
- Query rỗng → trả route hợp lệ (không crash)
- Sản phẩm không tồn tại ("RTX 9999") → trả array (có thể rỗng)
- SKU không tồn tại → trả array hợp lệ

### 8. Data Integrity (4/4 PASS)
- Phase 4 live: mode=live, 43 BL + 43 RAG, 0 errors
- Phase 4 mock: mode=mock
- Corpus SHA256 khớp giữa Phase 3 và Phase 4
- Không có data contamination mock/live

## Tổng kết

| Nhóm | Tests | Pass | Fail |
|---|---|---|---|
| Product Search | 3 | 3 | 0 |
| Policy | 2 | 2 | 0 |
| Vietnamese/SKU | 3 | 3 | 0 |
| Multi-turn | 2 | 2 | 0 |
| Query Routing | 5 | 5 | 0 |
| Context Building | 3 | 3 | 0 |
| Error Handling | 3 | 3 | 0 |
| Data Integrity | 4 | 4 | 0 |
| **Tổng Phase 5** | **25** | **25** | **0** |
| Phase 1-4 Regression | 126 | 126 | 0 |
| **Tổng toàn bộ** | **151** | **151** | **0** |

## Ghi chú

- Tất cả tests chạy offline, không gọi Gemini API → 0 chi phí quota
- Mock embeddings (deterministic hash-based 512-dim vectors) cho retrieval testing
- Corpus từ fixture `tests/fixtures/rag-phase3-corpus.json` — cùng dữ liệu với Phase 3-4
- Gemini smoke test: Phase 4 live evaluation (86/86 records) đã xác nhận end-to-end pipeline hoạt động với API thật
