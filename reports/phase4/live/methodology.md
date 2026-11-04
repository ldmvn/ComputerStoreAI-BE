# DUCMANH PC — Phase 4: Methodology

## 1. Thiết kế thực nghiệm

### Mục tiêu
Đánh giá định lượng chất lượng AI Chatbot DUCMANH PC qua ba tiêu chí RAG Triad:
- **Context Relevance:** Chunks truy xuất có liên quan đến câu hỏi?
- **Groundedness/Faithfulness:** Câu trả lời có được chứng minh bằng dữ liệu nguồn?
- **Answer Relevance:** Câu trả lời có giải quyết đúng câu hỏi?

### Hai cấu hình so sánh
- **Baseline A:** Gemini + Function Calling (không RAG retrieval)
- **System B:** Gemini + Hybrid RAG (Semantic + BM25 + RRF) + Function Calling

## 2. Bộ dữ liệu

- **43 câu hỏi benchmark** bao phủ: model (8), SKU (6), Vietnamese accent (4), policy (4), comparison (4), multi-turn (7), routing (5), negative (3), missing (2)
- **Corpus:** 578 chunks từ 145 tài liệu (SHA256: `f6aee9d6ede860eae37a507647c26e93ca20d79295e16a9e53e4924951cb972d`)
- Dữ liệu sản phẩm và chính sách thật từ Knowledge Base DUCMANH PC
- Nhãn relevance ở cấp document, do engineering team gán

## 3. Quy trình đánh giá

### Context Relevance (kết hợp)
- **Deterministic (40%):** Precision = chunks thuộc document relevant / tổng chunks. Recall = document relevant tìm thấy / tổng document relevant.
- **LLM Judge (60%):** Gemini đánh giá từng chunk có liên quan đến query không, thang 0–1.
- Kết hợp: 0.4 × deterministic + 0.6 × LLM.
- N/A khi không có retrieval (baseline cho query không cần RAG).

### Groundedness / Faithfulness (2 bước)
1. **Trích xuất claims:** LLM tách các khẳng định cụ thể từ câu trả lời.
2. **Xác minh:** LLM kiểm tra từng claim đối với context + tool results.
   - supported (1.0), general_knowledge (0.5), unsupported (0.0), contradicted (0.0)
- Score = trung bình điểm các claims.
- Hallucination Rate = (contradicted + unsupported) / total claims.
- Citation Support Rate = citations hợp lệ / tổng citations trong response.

### Answer Relevance
- LLM đánh giá: đúng sản phẩm, đầy đủ, đúng trọng tâm, thang 0–1.
- Bổ sung kiểm tra deterministic: response có nhắc đến product name trong relevant docs.

## 4. Thang điểm và rubric

Tất cả điểm trên thang 0.0–1.0:
- 1.0: Hoàn hảo
- 0.8: Tốt, sai sót nhỏ
- 0.6: Trung bình, thiếu hoặc lệch nhẹ
- 0.4: Yếu, thiếu nhiều hoặc sai
- 0.2: Rất yếu
- 0.0: Hoàn toàn sai hoặc không liên quan

## 5. Giới hạn và lưu ý

- Retrieval sử dụng mock embeddings (deterministic hash-based vectors), không phải Gemini semantic embeddings. Metrics retrieval (Recall, MRR, nDCG) đã đo riêng ở Phase 3.
- LLM scoring sử dụng Gemini API thật.
- Nhãn relevance ở cấp document (không phải chunk-level).
- Gemini Free Tier: 15 RPM, 500 RPD — giới hạn số evaluation có thể chạy/ngày.
- Temperature judge = 0.0 để tăng tính nhất quán, nhưng LLM judgment vẫn có biến thiên.

## 6. Khả năng tái lập

- Corpus SHA256: `f6aee9d6ede860eae37a507647c26e93ca20d79295e16a9e53e4924951cb972d`
- Dataset: `backend/tests/evaluation/phase3.dataset.mjs` (43 câu)
- Config: `backend/tests/evaluation/phase4/config.mjs`
- Engine: `backend/tests/evaluation/phase4/engine.mjs`
- Tất cả kết quả lưu trong `backend/reports/phase4/`
