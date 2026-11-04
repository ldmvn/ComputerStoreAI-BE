**DUCMANH PC — Sửa Multi-turn RAG/Product Context, 27/10/2026 (Asia/Bangkok)**

Đã sửa và kiểm tra bằng trình duyệt Edge thật → frontend Next.js ở localhost:3000 → Express ở localhost:5000 → Gemini thật. Backend local đã được restart có kiểm tra đúng service/process để nạp mã mới. Không thay schema/migration, không reset/ghi MySQL, không sửa Checkout/Payment/Auth, không commit/push. Source reconciliation khi startup dùng lại 578/578 embeddings, không tạo embedding mới.

**Nguyên nhân gốc và audit luồng**

1. Tiến trình backend ban đầu vẫn giữ module cũ trong RAM. API thực trả các reason `knowledge_question`/`general_question` và không có metrics/context trace của mã Phase 3 trên đĩa. Cả ba request thực dùng cùng conversationId, nhưng backend không áp dụng memory/rewrite hiện có trên đĩa. Vì vậy không thể coi 72 unit tests trên mã mới là bằng chứng server đang chạy đã nạp Phase 3. Đã nạp lại đúng backend, không dừng frontend hoặc tiến trình khác.
2. Mã Phase 3 trên đĩa cũng có lỗi độc lập: `extractTurnEntities` ưu tiên chuỗi identifiers và trả `sn850x`, làm mất `WD_BLACK`, dung lượng 1TB, productId và SKU. Hai phiên bản 1TB/2TB vì vậy có thể cạnh tranh trong retrieval; chưa có thực thể sản phẩm được ràng buộc chắc chắn.
3. `identifiers('Samsung 990 Pro')` trước sửa trả `[]`. Câu so sánh không xác định được đối tượng mới; BM25/semantic có thể đưa Samsung 980 Pro vào vì tên gần giống. Citation validation cũ chỉ kiểm tra số nguồn tồn tại, không chặn sai model/dung lượng.
4. `useAIChat` nằm trong `AIChatWindow`; widget đóng hoặc quay về Support sẽ unmount component, xóa messages và conversationId. Luồng khi panel giữ mở vốn truyền ID đúng; đóng/mở là đường mất session riêng. Đã đưa hook lên widget cha luôn được mount, dùng ref cho ID/request lock và bỏ response cũ sau reset/đổi user.
5. Gemini chỉ nhận câu hiện tại cùng system prompt, nên có thể chào lại ở các lượt sau. Đã cung cấp trạng thái tiếp tục hội thoại, danh sách đối tượng được pin và chặn lời chào đầu câu ở backend cho follow-up. Một phiên live đầu tiên thực sự phát hiện Gemini vẫn chào sau reopen dù prompt cấm; phiên cuối đã kiểm tra lại sau khi bổ sung xử lý này.
6. Gemini có thể xuất `[Nguồn 1, Nguồn 2]` hoặc `(Nguồn 1, 2)`. Parser cũ chỉ nhận nguồn đơn. Đã chuẩn hóa nhóm nguồn, giữ nguồn hợp lệ và chỉ loại tham chiếu không tồn tại.

Luồng hiện tại: `FloatingSupportWidget/useAIChat` → `postAiChat` (same ID, cookie/Bearer như cũ) → `parseChatRequest` → `optionalAuth`/`postChat` (`req.user.userId`) → `ConversationMemory` theo userId + conversationId → resolve thực thể từ catalog của vector snapshot → rewrite → router → filter productId cho cả BM25/vector → kiểm tra model/dung lượng/SKU → buildContext → Gemini → kiểm tra citation → frontend.

**Thay đổi hành vi**

- `productContext.js` tạo catalog sản phẩm từ metadata và SKU thực trong chunks, hỗ trợ cả index cũ chưa có metadata.sku. Memory giữ `{ productId, sku, label, models, capacity, sourceRef }`, thay vì chỉ chuỗi model.
- Câu mới có model rõ ràng thay chủ đề sản phẩm; câu đại từ giữ đối tượng cũ. Câu so sánh giữ đối tượng trước và thêm đúng model mới. Không lấy kết quả semantic ngẫu nhiên làm đối tượng hội thoại.
- Rewrite trước retrieval:
  - `Nó có phù hợp chơi game không?` → `WD_BLACK SN850X 1TB có phù hợp chơi game không?`
  - `So sánh nó với Samsung 990 Pro.` → `So sánh WD_BLACK SN850X 1TB với Samsung 990 Pro.`
- Filter theo productId thực đã xác định, kiểm tra lại model/dung lượng/SKU trong Hybrid và context builder. Không trộn SN850X 2TB vào yêu cầu 1TB; không thay 990 Pro bằng 980 Pro. Model mới thiếu dữ liệu được giữ tên và đánh dấu thiếu, không thay bằng tên gần giống.
- Nếu model mới có nhiều dung lượng, chỉ hỏi dung lượng của model đó, giữ sản phẩm cũ. Có pending state để nhận câu trả lời như `2TB`. Nếu đã xác định đủ thì không hỏi lại tên sản phẩm.
- `Còn bản 2TB?` có thể đổi phiên bản trong cùng dòng; SKU `...003`/`...004` được giải về productId khác nhau. Hai sản phẩm cùng có thể được đại từ tham chiếu mà không có lựa chọn rõ ràng thì yêu cầu làm rõ.
- Đổi chủ đề không liên quan xóa đối tượng đang tham chiếu; lời cảm ơn ngắn giữ đối tượng. Nút “Cuộc trò chuyện mới” tạo session mới và hủy response đang chờ của session trước. Đổi user đăng nhập reset session frontend; token refresh của cùng user không tự reset.
- `_context` trong response hỗ trợ kiểm tra query rewrite, các sản phẩm đang được pin và số lượt memory; không đưa dữ liệu đơn hàng hay lịch sử toàn bộ vào context.

**Kết quả phiên chat thật cuối cùng**

ConversationId: `005127ca-171d-418d-8f3f-e2d3519a52d9`. Cả ba request đầu tiên từ trình duyệt, không chỉ response, giữ đúng ID này.

| Lượt | Câu hỏi | Product/citation trước sửa | Product/citation sau sửa | Latency backend cuối |
|---|---|---|---|---:|
| 1 | WD_BLACK SN850X 1TB có những công nghệ nổi bật nào? | 244 **và 245 (2TB)** | Chỉ **244, 1TB, SEED-SSDM2-003** | 2,14 giây |
| 2 | Nó có phù hợp chơi game không? | Hỏi lại sản phẩm; nguồn 217/284/187/234/261 | Hiểu đúng WD_BLACK SN850X 1TB; chỉ nguồn **244** | 2,15 giây |
| 3 | So sánh nó với Samsung 990 Pro. | So sánh 990 Pro với **980 Pro**; nguồn 249/242/243 | So sánh WD_BLACK SN850X 1TB với Samsung 990 Pro 1TB; chỉ nguồn **244 và 249** | 4,39 giây |

Các kiểm tra live bổ sung đều pass:

- Đóng/mở widget rồi hỏi `Con đầu có phù hợp chơi game không?`: ID không đổi, nguồn chỉ productId 244, không chào lại.
- `Thông số SEED-SSDM2-004`: đổi đúng sang productId 245, WD_BLACK SN850X **2TB**, không chào lại, 0 query embedding call cho SKU exact.
- Đổi chủ đề thời tiết: products/citations rỗng, không retrieval/tool. Đại từ sau đó được yêu cầu chỉ rõ sản phẩm vì ngữ cảnh thực sự đã đổi, 0 Gemini call cho lượt làm rõ.
- Bấm “Cuộc trò chuyện mới”, hỏi `Nó...`: ID mới `58ddcde3-af79-4087-a83b-08a9249187a7`, priorTurns=0, không kế thừa sản phẩm từ phiên cũ, 0 Gemini call.
- Responsive: Mobile **320×740** (dialog 288×520), Tablet **768×1024**, Desktop **1440×1000** (dialog 340×520). Không tràn ngang hoặc vượt viewport; không có pageerror. Có screenshot cho từng kích thước.

Phiên live cuối gồm 8 lượt HTTP: **6 Gemini generation calls, 4 query embedding calls, 0 rewrite API calls**. UsageMetadata từ provider: **6.647 prompt tokens, 1.813 completion tokens**. Đây là số đo của phiên cuối, không phải tổng billing của toàn quá trình debug. Ngoài phiên này đã có 3 lượt baseline, 6 lượt ở phiên live đầu và các health check khi restart; không dùng Gemini thật cho regression tự động.

**Kiểm thử tự động**

- Bộ Phase 3 hiện có: **72/72 pass**.
- Bộ bổ sung: **13/13 pass**, gồm 12 ca product context/citation và 1 kiểm thử HTTP nhiều lượt qua router/controller/auth thật, memory thật, Hybrid/BM25/context thật, GeminiProvider thật với SDK client mock.
- HTTP regression dùng token test ký bằng secret chỉ dành cho test; chuyển Bearer → cookie vẫn giữ owner/userId 7 và cùng session. UserId 8, token không hợp lệ và conversationId mới không kế thừa context của userId 7. Không thay logic Auth hoặc đăng nhập account/database thật.
- Regression dùng chính ba câu báo lỗi; kiểm tra payload SDK Gemini nhận đúng rewrite, productId, SKU, capacity và nguồn, không có Samsung 980 Pro hoặc SN850X 2TB trong comparison context.
- Ca dung lượng/SKU: 500GB, 1TB, 2TB; `SEED-SSDM2-003`/`...004`; thiếu model mới; model mới nhiều dung lượng; đổi chủ đề; session mới; nguồn metadata sai dung lượng dù giả productId đúng; grouped citations; provider cố tình chào lại.
- Frontend TypeScript: pass. `git diff --check`: pass (Git chỉ thông báo CRLF/LF của một số file đã có thay đổi từ trước).

```powershell
npm.cmd run test:rag:phase3 --prefix backend
npm.cmd run test:rag:multiturn --prefix backend
npm.cmd run type-check --prefix frontend
# Opt-in, dùng Gemini thật và cần frontend/backend local đang chạy:
node frontend/tests/ai-multiturn.live.mjs --live
```

**Artifact**

- `live-before.json`: transcript API thật trước sửa, cùng ID nhưng mất tham chiếu và trộn nguồn.
- `live-after.json`: 8 lượt từ trình duyệt thật, request ID, response, rewrite, product scope, citations, token/call metrics và responsive measurements.
- `http-mock.json`: transcript HTTP regression và payload cuối đi vào Gemini SDK; không chứa secret, cookie hoặc token test.
- `browser-run.txt`: log phiên live cuối và kết quả PASS.
- `mobile.png`, `tablet.png`, `desktop.png`: screenshot responsive.

**File sửa/thêm trong đợt fix này**

```text
backend/package.json
backend/src/ai/services/aiChat.service.js
backend/src/ai/rag/rag.service.js
backend/src/ai/rag/routing/conversationContext.js
backend/src/ai/rag/routing/productContext.js                         (mới)
backend/src/ai/rag/retrieval/text.js
backend/src/ai/rag/retrieval/hybridRetriever.js
backend/src/ai/rag/context/contextBuilder.js
backend/tests/unit/productContext.test.mjs                          (mới)
backend/tests/multiturnRag.http.mjs                                  (mới)
frontend/src/hooks/useAIChat.ts
frontend/src/components/layout/support-widget/FloatingSupportWidget.tsx
frontend/src/components/ai/AIChatWindow.tsx
frontend/src/components/ai/AIChatHeader.tsx
frontend/tests/ai-multiturn.live.mjs                                 (mới)
backend/reports/multiturn-fix/*                                     (mới)
```

Đã audit `frontend/src/services/ai.service.ts`, backend controller/validator/router, Query Router và Gemini Provider; các module này tiếp tục được dùng, không viết lại. Các file Prisma/Auth/Checkout/Payment không được đợt fix chỉnh sửa. Workspace vẫn có thay đổi Phase 1–3 từ trước, nên `git diff` toàn bộ không chỉ đại diện đợt fix này.

**Giới hạn còn lại**

- Memory backend vẫn là RAM, TTL 30 phút và tối đa 4 lượt thực thể. Restart/đổi replica hoặc hết TTL cần người dùng nêu lại đối tượng còn thiếu. Chưa thêm storage/session phân tán hoặc migration.
- Session frontend được giữ khi đóng/mở panel trong cùng widget đã mount; chưa có persistence qua reload toàn trang hoặc unmount CustomerShell. Tạo cuộc trò chuyện mới và đổi user chủ động tách session.
- Nhận diện model/alias vẫn là logic nhẹ; một số tên không có mã model hoặc cách viết ngoài bộ nhận diện có thể cần tên/SKU rõ hơn. Không gọi thêm LLM để suy đoán.
- Kiểm tra citation chặn sai sản phẩm/model/dung lượng/SKU và số nguồn, chưa chứng minh mọi mệnh đề được nguồn hỗ trợ. Chất lượng factual của dữ liệu KB, citation entailment và RAG Triad tiếp tục thuộc Phase 4.
- Authenticated continuity đã xác minh bằng HTTP với JWT test; phiên browser live là anonymous, không đăng nhập hoặc dùng tài khoản khách hàng thật.
