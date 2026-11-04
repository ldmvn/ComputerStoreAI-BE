**DUCMANH PC — Hiển thị RAG citations, 27/10/2026**

Đã thay danh sách nguồn dài dưới câu trả lời bằng mục **“Nguồn tham khảo (N)”**, mặc định đóng. Dùng `<details>/<summary>` hỗ trợ bàn phím, màu cam/trắng, tên nguồn tối đa hai dòng với tên đầy đủ trong tooltip và liên kết. Không đổi backend, Hybrid Retrieval, Function Calling hoặc truy vấn MySQL.

**Mapping và dữ liệu kiểm chứng**

`frontend/src/lib/aiCitations.ts` tạo view model từ answer/citations gốc:

- Gộp theo productId hoặc documentId; giữ riêng các productId khác nhau để không gộp nhầm phiên bản/dung lượng.
- Chỉ lấy citations được inline thực sự sử dụng. Đánh số hiển thị theo thứ tự xuất hiện đầu tiên, không giữ khoảng trống số cũ.
- Mỗi nguồn có `chunks` chứa citation gốc; `referenceMap` giữ `originalSourceNumber → displaySourceNumber` và toàn bộ citation/chunk metadata tương ứng.
- Chỉ thay số trong bản text dùng để render. `ChatMessage.content`, API answer, citations gốc và số nguồn theo context backend không bị sửa; RAG Triad tiếp tục dùng answer/context gốc để kiểm chứng.
- Giữ chunkId, documentId, sourceNumber gốc, productId, sourceRef, score, SKU và updatedAt khi lưu lịch sử chat. Mapping có thể được dựng lại sau khi load lịch sử.
- Nhận cả nguồn đơn, nhóm nguồn và cú pháp ngoặc; gộp marker inline trùng cạnh nhau, nhưng giữ marker ở các mệnh đề khác nhau. Không coi code block, inline code hoặc Markdown link là citation.
- Không tạo nguồn cho số không tồn tại hoặc số trỏ đến nhiều nguồn mâu thuẫn. Slug không an toàn/không xác định hoặc nhiều slug khác nhau trong một nguồn được hiển thị dạng text, không đoán liên kết. Policy chỉ link các route có thật trong whitelist.

Ví dụ đã kiểm thử trên browser:

| Nguồn chunk gốc | Sản phẩm | Số hiển thị |
|---|---|---|
| 2 → product:244::chunk-0 | WD_BLACK SN850X 1TB | 1 |
| 4 → product:244::chunk-3 | WD_BLACK SN850X 1TB | 1 |
| 6 → product:249::chunk-0 | Samsung 990 Pro 1TB | 2 |
| 8 → product:245::chunk-0, không được câu trả lời dùng | WD_BLACK SN850X 2TB | Không hiển thị |

**Kiểm thử**

- `npm.cmd run test:ai-citations --prefix frontend`: **12/12 pass**. Bao phủ product/document deduplication, alias bắc cầu, số nguồn thưa/đổi thứ tự, grouped markers, nguồn không dùng, metadata mâu thuẫn, liên kết an toàn, không sửa answer/chunks gốc và lưu/khôi phục metadata cho RAG Triad.
- `npm.cmd run test:ai-citations:e2e --prefix frontend`: **pass**. Trình duyệt Edge thật và frontend Next thật, chat response mock, **0 Gemini calls**. Xác minh mặc định đóng, mở/đóng bằng Enter, chỉ hai nguồn sau gộp, số inline đúng, nguồn 2TB không được dùng không xuất hiện, metadata gốc còn trong localStorage và câu trả lời không có inline không sinh thêm mục nguồn.
- Link `/products/seed-ssdm2-003` được mở trong browser và xác nhận heading của sản phẩm thật SN850X 1TB. Link nguồn còn lại trỏ `/products/seed-ssdm2-008`.
- Desktop 1440×1000, Tablet 768×1024, Mobile 320×740: không tràn ngang hoặc vượt viewport; không có pageerror. Đã kiểm tra screenshot.
- `npm.cmd run type-check --prefix frontend`: pass.
- `git diff --check`: pass; chỉ có cảnh báo chuẩn hóa CRLF/LF của một số file có sẵn.

**File sửa/thêm**

```text
frontend/src/components/ai/AIChatMessage.tsx
frontend/src/lib/aiCitations.ts                         (mới)
frontend/src/lib/chatHistory.ts                        (giữ chunk provenance khi lưu)
frontend/src/types/ai.type.ts
frontend/package.json
frontend/tests/aiCitations.unit.test.ts                (mới)
frontend/tests/ai-citations.playwright.mjs              (mới)
backend/reports/citation-display/README.md
backend/reports/citation-display/browser.json
backend/reports/citation-display/desktop-collapsed.png
backend/reports/citation-display/desktop-expanded.png
backend/reports/citation-display/tablet-expanded.png
backend/reports/citation-display/mobile-expanded.png
```

Các file Auth/history khác có sẵn trong workspace được giữ nguyên. Không reset database, không commit/push. Bộ test chỉ mock response ở trình duyệt và đọc trang sản phẩm để xác minh link; không ghi dữ liệu MySQL.

Giới hạn: lịch sử cũ đã bị bỏ chunkId trước bản sửa không thể khôi phục chunkId từ frontend. Metadata còn lại vẫn dùng được để gộp nguồn; các câu trả lời mới giữ đủ chunk provenance. Việc nguồn có hỗ trợ từng mệnh đề hay không vẫn cần RAG Triad/groundedness evaluation, không thể kết luận chỉ từ việc số nguồn khớp.
