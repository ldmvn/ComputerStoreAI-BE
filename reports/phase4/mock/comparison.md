# DUCMANH PC — Phase 4: So sánh Baseline vs Hybrid RAG

## Thông tin thực nghiệm
- **Ngày:** 2026-10-27
- **Corpus:** 578 chunks, 145 documents (SHA256: `f6aee9d6ede860ea…`)
- **Chế độ:** Mock/Offline (điểm mô phỏng, không phải kết quả Gemini thật)
- **Model tạo câu trả lời:** gemini-2.0-flash-lite
- **Model đánh giá:** gemini-2.0-flash-lite
- **Bộ benchmark:** 43 câu hỏi (model, SKU, policy, comparison, multi-turn, negative, missing)

## Tổng hợp RAG Triad

| Tiêu chí | Baseline (FC only) | Hybrid RAG + FC | Δ |
|---|---|---|---|
| **Context Relevance** | N/A (n=0) | 0.7374 (n=34) | N/A |
| **Groundedness** | 1.0000 (n=43) | 1.0000 (n=43) | 0.0000 |
| **Answer Relevance** | 0.8000 (n=43) | 0.8000 (n=43) | 0.0000 |

## Metrics bổ sung

| Metric | Baseline | Hybrid RAG |
|---|---|---|
| Hallucination Rate | 0.0% | 0.0% |
| Citation Support Rate | N/A | N/A |
| Routing Accuracy | 100.0% | 100.0% |
| Latency (median) | 0.0198 ms | 2.3624 ms |
| Latency (p95) | 0.3145 ms | 8.0151 ms |
| Gemini API Calls | 172 | 206 |
| Embedding Calls | 0 | 30 |
| Prompt Tokens | 17200 | 20600 |
| Completion Tokens | 8600 | 10300 |
| Errors | 0 | 0 |

## Phân tích theo nhóm câu hỏi

### model
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.7575 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 8 | 8 |

### sku
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.8500 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 6 | 6 |

### vietnamese
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.6300 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 4 | 4 |

### policy
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.6300 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 4 | 4 |

### comparison
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.7775 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 4 | 4 |

### multi_turn
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.6580 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 7 | 7 |

### routing
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.8233 |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 5 | 5 |

### negative
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | N/A |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 3 | 3 |

### missing
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | N/A |
| Groundedness | 1.0000 | 1.0000 |
| Answer Relevance | 0.8000 | 0.8000 |
| Cases | 2 | 2 |


> **Lưu ý:** Kết quả trên sử dụng mock provider (không gọi Gemini API thật). Điểm số phản ánh hoạt động pipeline, không phải chất lượng thực tế. Chạy lại với `--mode live` để có kết quả thực nghiệm.

