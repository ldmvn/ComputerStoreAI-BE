# DUCMANH PC — Phase 4: So sánh Baseline vs Hybrid RAG

## Thông tin thực nghiệm
- **Ngày:** 2026-10-27
- **Corpus:** 578 chunks, 145 documents (SHA256: `f6aee9d6ede860ea…`)
- **Chế độ:** Live (Gemini API thật)
- **Model tạo câu trả lời:** gemini-2.0-flash-lite
- **Model đánh giá:** gemini-2.0-flash-lite
- **Bộ benchmark:** 43 câu hỏi (model, SKU, policy, comparison, multi-turn, negative, missing)

## Tổng hợp RAG Triad

| Tiêu chí | Baseline (FC only) | Hybrid RAG + FC | Δ |
|---|---|---|---|
| **Context Relevance** | N/A (n=0) | 0.7921 (n=34) | N/A |
| **Groundedness** | 0.2247 (n=34) | 0.7574 (n=27) | +0.5327 |
| **Answer Relevance** | 0.9581 (n=43) | 0.9349 (n=43) | -0.0232 |

## Metrics bổ sung

| Metric | Baseline | Hybrid RAG |
|---|---|---|
| Hallucination Rate | 55.1% | 21.6% |
| Citation Support Rate | N/A | N/A |
| Routing Accuracy | 100.0% | 100.0% |
| Latency (median) | 8390.2591 ms | 15341.0047 ms |
| Latency (p95) | 42953.3437 ms | 26863.2419 ms |
| Gemini API Calls | 154 | 174 |
| Embedding Calls | 0 | 0 |
| Prompt Tokens | 0 | 0 |
| Completion Tokens | 0 | 0 |
| Errors | 0 | 0 |

## Phân tích theo nhóm câu hỏi

### model
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.8325 |
| Groundedness | 0.4900 | 1.0000 |
| Answer Relevance | 0.9750 | 0.9250 |
| Cases | 8 | 8 |

### sku
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 1.0000 |
| Groundedness | 0.2083 | 0.9760 |
| Answer Relevance | 1.0000 | 1.0000 |
| Cases | 6 | 6 |

### vietnamese
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.6900 |
| Groundedness | 0.1250 | 1.0000 |
| Answer Relevance | 1.0000 | 0.9500 |
| Cases | 4 | 4 |

### policy
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.7200 |
| Groundedness | 0.0000 | 1.0000 |
| Answer Relevance | 1.0000 | 1.0000 |
| Cases | 4 | 4 |

### comparison
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.8375 |
| Groundedness | 0.0000 | N/A |
| Answer Relevance | 1.0000 | 0.8500 |
| Cases | 4 | 4 |

### multi_turn
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.5440 |
| Groundedness | 0.3500 | 0.7067 |
| Answer Relevance | 0.9143 | 0.8857 |
| Cases | 7 | 7 |

### routing
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | 0.8533 |
| Groundedness | 0.3000 | 0.5000 |
| Answer Relevance | 0.8800 | 0.8800 |
| Cases | 5 | 5 |

### negative
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | N/A |
| Groundedness | 0.0000 | 0.0000 |
| Answer Relevance | 0.8667 | 1.0000 |
| Cases | 3 | 3 |

### missing
| Tiêu chí | Baseline | RAG |
|---|---|---|
| Context Relevance | N/A | N/A |
| Groundedness | 0.1500 | 0.1650 |
| Answer Relevance | 1.0000 | 1.0000 |
| Cases | 2 | 2 |


