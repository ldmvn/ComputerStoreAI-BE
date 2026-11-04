# DUCMANH PC — Phase 5: Phân tích các trường hợp chưa tốt

## Tổng quan
- Tổng câu hỏi: 43 (mỗi cấu hình)
- Các vấn đề phát hiện: 24
- Dữ liệu: Phase 4 Live Evaluation (Gemini API thật)

## Groundedness thấp (RAG < 0.5)

| ID | Category | Query | RAG Score | BL Score | Halluc. Rate | Claims |
|---|---|---|---|---|---|---|
| turn-03 | multi_turn | Còn giá và tồn kho? | 0.3800 | 0.0000 | 25.0% | 4 |
| turn-06 | multi_turn | Nó có tốt không? | 0.0000 | N/A | 100.0% | 1 |
| mixed-02 | routing | RTX 4060 giá bao nhiêu? | 0.0000 | 0.0000 | 100.0% | 2 |
| negative-01 | negative | Xin chào | 0.0000 | 0.0000 | 100.0% | 1 |
| negative-02 | negative | Thời tiết hôm nay ở Hà Nội có mưa không? | 0.0000 | 0.0000 | 100.0% | 1 |
| negative-04 | missing | Thông số RTX 9999 | 0.3300 | 0.3000 | 33.0% | 3 |
| negative-05 | missing | Thông số SKU-NOT-EXIST-999 | 0.0000 | 0.0000 | 100.0% | 1 |

**Chi tiết claims unsupported/contradicted:**

- **turn-03:** Cửa hàng DUCMANH PC hiện có nhiều phiên bản RTX 4060 Ti khác nhau.
- **turn-06:** DUCMANH PC là tên của cửa hàng
- **mixed-02:** DUCMANH PC có nhiều mẫu RTX 4060 từ các hãng ASUS, MSI, Gigabyte, Colorful; Giá RTX 4060 dao động trong khoảng từ 7.500.000đ đến 9.500.000đ
- **negative-01:** Mình là trợ lý mua sắm AI của DUCMANH PC
- **negative-02:** DUCMANH PC là cửa hàng chuyên linh kiện máy tính
- **negative-04:** DUCMANH PC chưa có thông tin về dòng card đồ họa RTX 9999
- **negative-05:** Mã sản phẩm SKU-NOT-EXIST-999 không tồn tại trong hệ thống của DUCMANH PC.

## Answer Relevance thấp (RAG < 0.7)

| ID | Category | Query | RAG Score | BL Score | Completeness |
|---|---|---|---|---|---|
| model-05 | model | RX 7600 có hiệu năng thế nào? | 0.6000 | 0.8000 | medium |
| turn-06 | multi_turn | Nó có tốt không? | 0.4000 | 0.4000 | low |
| mixed-03 | routing | So sánh RTX 4060 và RTX 4060 Ti kèm giá | 0.6000 | 1.0000 | medium |

## RAG tệ hơn Baseline (AR giảm > 0.1)

| ID | Category | Query | RAG AR | BL AR | Δ |
|---|---|---|---|---|---|
| model-05 | model | RX 7600 có hiệu năng thế nào? | 0.6000 | 0.8000 | -0.2000 |
| model-08 | model | Thông số bo mạch Gigabyte B850M DS3H | 0.8000 | 1.0000 | -0.2000 |
| vi-04 | vietnamese | thong so card man hinh RTX4060Ti | 0.8000 | 1.0000 | -0.2000 |
| compare-01 | comparison | So sánh RTX 4060 và RTX 4060 Ti | 0.8000 | 1.0000 | -0.2000 |
| compare-02 | comparison | So sánh RTX 4070 SUPER với RTX 4070 Ti SUPER | 0.8000 | 1.0000 | -0.2000 |
| compare-03 | comparison | So sánh i7-13700K với Ryzen 7 7800X3D | 0.8000 | 1.0000 | -0.2000 |
| turn-05 | multi_turn | Con đầu có thông số gì? | 0.8000 | 1.0000 | -0.2000 |
| mixed-03 | routing | So sánh RTX 4060 và RTX 4060 Ti kèm giá | 0.6000 | 1.0000 | -0.4000 |

## Context Relevance thấp (< 0.5)

| ID | Category | Query | Score | Retrieved Chunks |
|---|---|---|---|---|
| model-05 | model | RX 7600 có hiệu năng thế nào? | 0.3200 | 5 |
| model-08 | model | Thông số bo mạch Gigabyte B850M DS3H | 0.4400 | 5 |
| vi-04 | vietnamese | thong so card man hinh RTX4060Ti | 0.3200 | 5 |
| turn-01 | multi_turn | Nó có thông số thế nào? | 0.2000 | 5 |
| turn-02 | multi_turn | Con này tiêu thụ bao nhiêu watt? | 0.2000 | 5 |
| turn-05 | multi_turn | Con đầu có thông số gì? | 0.3200 | 5 |

## Phân tích nguyên nhân và hướng cải thiện

### 1. Groundedness thấp ở Baseline
- **Nguyên nhân chính:** Baseline không có RAG context → Gemini trả lời từ general knowledge → nhiều claims không có bằng chứng từ dữ liệu cửa hàng.
- **Hallucination rate baseline 55.1%** là kỳ vọng — không có dữ liệu nguồn, mọi claim cụ thể về sản phẩm DUCMANH PC đều "unsupported".

### 2. Groundedness cải thiện rõ rệt với RAG
- **RAG 0.7574 vs Baseline 0.2247** (+53.3 điểm) — RAG cung cấp evidence cho đa số claims.
- **SKU queries:** 0.21 → 0.98 — gần hoàn hảo khi có context chính xác.
- **Policy queries:** 0.00 → 1.00 — baseline hoàn toàn bịa chính sách, RAG trích dẫn đúng.

### 3. Các trường hợp RAG chưa tối ưu
- **Multi-turn:** Context relevance 0.54 — query rewriting đôi khi chưa giải đại từ đủ tốt.
- **Comparison queries:** Groundedness N/A ở một số cặp — claim extraction khó với so sánh dài.
- **Missing/negative queries:** Groundedness thấp cả hai — expected behavior (không có dữ liệu để support).

### 4. Hướng cải thiện
- Cải thiện multi-turn query rewriting cho các tham chiếu phức tạp.
- Bổ sung chunk-level relevance labels thay vì chỉ document-level.
- Thêm claim extraction prompt cho queries so sánh nhiều sản phẩm.
- Xem xét real semantic embeddings (Gemini Embedding API) thay cho mock hash vectors.
