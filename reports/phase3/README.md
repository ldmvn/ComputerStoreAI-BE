**DUCMANH PC — Báo cáo Phase 3, ngày 27/10/2026 (Asia/Bangkok)**

Đã triển khai trực tiếp trên nền Phase 1/2 trong workspace. Không thay Prisma schema/migration, không reset hoặc ghi dữ liệu MySQL, không commit/push. Không sửa Auth, Checkout, Payment, Admin hay service AI Build PC. Các thay đổi Phase 1/2 có sẵn được giữ lại; `git diff` toàn workspace vì vậy chứa cả công việc trước phiên này.

**Hành vi đã triển khai**

- Multi-turn: lưu tối đa 4 lượt thực thể, TTL 30 phút, giới hạn 1.000 session; tách theo userId và conversationId. Retrieval chỉ nhận câu hiện tại cộng tối đa 3 thực thể liên quan, không nhận toàn bộ hội thoại. Xử lý đại từ, câu rút gọn, so sánh tiếp nối và thứ tự sản phẩm; tham chiếu mơ hồ yêu cầu làm rõ với 0 Gemini/retrieval/tool calls. Không lưu nội dung đơn hàng hay văn bản trả lời của assistant.
- Hybrid: chuẩn hóa dấu tiếng Việt/đ, stop words, nhận diện model/SKU và biến thể dấu cách/gạch nối; thêm title/brand/SKU vào BM25. Giữ phân biệt RTX 4060, 4060 Ti, 4070 SUPER, 4070 Ti SUPER và SKU có hậu tố khác. Metadata filter chạy trên cả hai nhánh; RRF giữ điểm/rank từng nguồn, reranker xác định ưu tiên danh tính, đa dạng hóa theo document.
- Semantic: loại cosine < 0,35; cache query embedding 5 phút, tối đa 256 mục, gộp request cùng query đang chạy; bỏ embedding khi đã khớp SKU hoặc chưa có vector. Timeout query mặc định 4 giây; lỗi embedding hạ về BM25. Không thêm Python service, mô hình hoặc dependency.
- Routing: kết hợp các đặc trưng intent, thực thể đã giải tham chiếu, ngữ cảnh và độ phức tạp. Chỉ cấp tool phù hợp từng route; route `none` không cấp tool. Tách kiến thức kỹ thuật khỏi giá/tồn kho, chính sách và tra đơn. Có giới hạn 3 vòng tool, 5 tool mỗi vòng, tối đa 4 lần completion và cache kết quả tool trùng trong cùng lượt.
- Context: budget 500/900/1.300/1.900 token ước lượng cho simple/policy/technical/comparison; loại chunk trùng, chồng lặp gần như toàn bộ trong cùng document, điểm thấp và một số mẫu injection. Mỗi chunk là một JSON record được escape trong ranh giới dữ liệu không tin cậy; rút gọn bên trong record để giữ delimiter và citation khớp nhau. Không lấy giá/tồn kho từ vector index; dữ liệu thương mại hiện tại chỉ từ search_products/MySQL.
- Citation: chỉ trả các nguồn được câu trả lời viện dẫn, phát hiện/loại số nguồn không tồn tại, giữ documentId/chunkId/sourceRef/productId/title/updatedAt. Chat UI giữ và hiển thị citations với đường dẫn nội bộ tới sản phẩm/chính sách thật.
- Sync: vector snapshot là nguồn canonical; BM25 được dựng từ cùng snapshot. Incremental chỉ thay phạm vi productIds, giữ sản phẩm khác và policy; dọn cả chunk thừa và sản phẩm ngừng hoạt động. Delete không phụ thuộc embedding API. Retriever đang chạy đọc được snapshot mới.
- Durability: ghi temporary file + fsync + atomic rename, backup snapshot hợp lệ, khóa writer ở cấp filesystem giữa các instance/process; phát hiện lock của process đã chết. Journal ghi intent ngay trong CRUD hook; ack theo revision để không mất update đến trong lúc embedding. Job lỗi còn trong journal và retry backoff; checkpoint batch đã embedding được kiểm tra bằng id/nội dung/vector. Source reconciliation lúc startup và mỗi 15 phút khôi phục index thiếu/hỏng hoặc sự kiện bị bỏ lỡ. Index hỏng được giữ dưới tên `.corrupt` khi cần dựng lại.

**Benchmark trước/sau**

Corpus cố định: **145 documents, 578 chunks**, SHA-256 `f6aee9d6ede860eae37a507647c26e93ca20d79295e16a9e53e4924951cb972d`.

43 câu có nhãn, gồm 34 câu có document liên quan; bao phủ tiếng Việt không dấu, model gần giống, SKU, policy, so sánh, multi-turn, câu không liên quan, thiếu dữ liệu và routing phối hợp. Nhãn là document-level do kỹ sư xác định. Recall/MRR/nDCG tính tại 5 chunks; document lặp không được tính thêm gain.

| Chỉ số | Phase 2 baseline | Phase 3 |
|---|---:|---:|
| Recall@5 | 77,94% | 100% |
| MRR@5 | 0,5931 | 1,0000 |
| nDCG@5 | 0,6291 | 1,0000 |
| Routing đúng | 65,12% | 100% |
| Multi-turn Recall@5, 5 câu có nhãn retrieval | 20% | 100% |
| Embedding calls trên 43 câu | 38 | 30 |
| Gemini generation calls trong benchmark | 0 | 0 |
| Context tokens ước lượng trung bình, trên 43 câu | 1.093,51 | 767,95 |
| Latency local median | 0,96 ms | 1,44 ms |
| Latency local p95 | 1,27 ms | 2,49 ms |
| Câu thiếu model/SKU trả rỗng đúng, 2 câu | 0/2 | 2/2 |
| Cấp tool không cần thiết cho route none | 1 | 0 |

Context estimate giảm khoảng **29,77%**; embedding calls giảm **21,05%**. CPU local có tăng do kiểm tra danh tính, context và metadata; số đo này không bao gồm network, đọc index ban đầu hay thời gian Gemini trả lời.

Ablation giữ nguyên routing/token budget/filter/diversity và tắt reranker: Recall/MRR vẫn 1,0000; nDCG giảm còn **0,9956**. Vì có cải thiện nhỏ về thứ tự kết quả, giữ reranker xác định, không dùng thêm LLM.

**Giới hạn diễn giải benchmark:** cả hai phiên bản dùng cùng semantic embedding mock dạng hashed bag-of-words, không sử dụng nhãn để sinh vector. Kết quả kiểm tra lexical/fusion/model/routing/context trên tập cố định, không phải chứng nhận chất lượng Gemini hoặc độ chính xác production. 100% trên tập này không có nghĩa 100% với truy vấn mới. Token estimate dùng UTF-8 bytes/3 và không phải số token tính phí. Chưa đo billing, generation latency hay semantic recall bằng Gemini thật; không thực hiện request thật cho benchmark.

**Kiểm thử và dữ liệu Phase 4**

- `npm.cmd run test:rag:phase3 --prefix backend`: **72/72 pass**. Bao gồm hồi quy foundation/chat/Gemini provider, luồng chat qua retriever và tool mock, CRUD/incremental bằng nguồn dữ liệu giả lập, vector/BM25 đồng bộ, concurrent writers, restart/retry, checkpoint thất bại giữa batch, process bị kill, journal bị cắt, disk error trong hook, worker ack và CLI health/repair. Không dùng database thật hoặc AI API trong bộ kiểm thử cuối.
- `npm.cmd run type-check --prefix frontend`: pass.
- `git diff --check`: pass, chỉ có thông báo chuẩn hóa CRLF/LF từ Git.
- Baseline đầu phiên: 29/30 pass; sửa mock foundation từ `embed` sang `embedQuery` cho đúng interface Phase 2. Thay các test Gemini có gọi SDK/network hoặc assertion rỗng bằng SDK client mock với assertion thật.
- `benchmark.json`: số đo tổng, theo nhóm, ablation, corpus hash và mô tả phương pháp.
- `triad-records.jsonl`: **86 records** trước/sau gồm query, history thực thể, rewrite, nhãn, route, retrieval ranks/scores, metadata, context thực tế, selected chunks, citations, call counts và token estimates. `response`, `responseUsage` và ba điểm RAG Triad để `null` vì chưa tạo/chấm câu trả lời thật. Phase 4 có thể bổ sung response và context relevance/groundedness/answer relevance trên chính records này.
- `verification.txt`: log bộ kiểm thử tổng.

**Vận hành**

```powershell
npm.cmd run test:rag:phase3 --prefix backend
npm.cmd run benchmark:rag:phase3 --prefix backend
npm.cmd run rag:health --prefix backend
npm.cmd run rag:health --prefix backend -- --repair
```

`rag:health` chỉ đọc index/journal. `--repair` phục hồi backup vector hợp lệ nếu có và dựng lại BM25 từ vector hiện có, không gọi AI/database. Nếu cả vector chính và backup hỏng hoặc thiếu, ingest/source reconciliation sẽ đọc nguồn MySQL và chỉ embedding các chunk thực sự cần. Full ingest có thể phát sinh embedding API calls: chạy trong backend bằng `node scripts/rag-ingest.js`; incremental dùng `--product 123 456`. `--skip-embedding` xuất corpus BM25 phục vụ kiểm tra offline, không cập nhật vector canonical. `rag-test-retrieval.js` cũ là smoke test LIVE có embedding API cost; dùng benchmark Phase 3 để đánh giá offline.

`RAG_DATA_DIR` được dùng thống nhất; mặc định là `backend/data/rag`, không phụ thuộc cwd. `RAG_QUERY_EMBEDDING_TIMEOUT_MS` mặc định 4000. Cần restart backend đang chạy để nạp mã mới; phiên này không restart/deploy server hoặc chạy full ingest trên dữ liệu thật.

**Hạn chế còn lại**

- Memory hội thoại nằm trong process, mất khi restart và không chia sẻ giữa nhiều backend replica. Sau restart, câu chỉ có đại từ được yêu cầu làm rõ. Anonymous session dùng conversationId ngẫu nhiên và chỉ giữ thực thể sản phẩm, không giữ thông tin đơn hàng. Bài toán lưu session phân tán chưa nằm trong thay đổi này.
- Router/rewrite dùng các đặc trưng và quy tắc có ngữ cảnh, không có bước LLM rewrite dự phòng. Câu tham chiếu dài, thuật ngữ mới hoặc tên model ngoài bộ nhận diện có thể cần nêu lại tên/SKU.
- Chưa chạy HTTP CRUD trên MySQL thật; các ca sync dùng pipeline thật với loader/embedding giả lập và filesystem thật, vì mục tiêu không ghi database thật trong kiểm thử.
- Journal append-only chưa compact tự động. Ở quy mô hiện tại phù hợp; cần chính sách lưu trữ khi số sự kiện tăng lớn. Nếu disk lỗi, intent chỉ được giữ trong memory; full source reconciliation là đường khôi phục sau restart.
- Sync có tính eventual consistency, debounce 10 giây và backoff khi lỗi; không phải transaction chung với MySQL. Reconciliation có thể gọi embedding cho dữ liệu thiếu/thay đổi. File lock dành cho các process dùng cùng local filesystem, không thay thế coordinator cho nhiều máy/NFS.
- Citation validation xác nhận nguồn tồn tại trong context được cấp, chưa xác minh từng mệnh đề được nguồn hỗ trợ. Bộ lọc injection là phòng vệ nhiều lớp, không bảo đảm phát hiện mọi prompt injection. Kiểm tra groundedness/citation entailment, semantic threshold tuning, truy vấn mù và adversarial evaluation tiếp tục ở Phase 4.

**Danh sách file do Phase 3 chỉnh sửa/thêm**

```text
backend/.env.example
backend/package.json
backend/scripts/rag-ingest.js
backend/scripts/rag-test-retrieval.js
backend/scripts/rag-index-health.mjs
backend/src/ai/bootstrap.js
backend/src/ai/providers/gemini.provider.js
backend/src/ai/services/aiChat.service.js
backend/src/ai/rag/rag.service.js
backend/src/ai/rag/chunking/textChunker.js
backend/src/ai/rag/context/contextBuilder.js
backend/src/ai/rag/embeddings/gemini.embedding.js
backend/src/ai/rag/pipeline/ingestPipeline.js
backend/src/ai/rag/retrieval/bm25.js
backend/src/ai/rag/retrieval/hybridRetriever.js
backend/src/ai/rag/retrieval/text.js
backend/src/ai/rag/routing/queryRouter.js
backend/src/ai/rag/routing/conversationContext.js
backend/src/ai/rag/storage/atomicJson.js
backend/src/ai/rag/sync/knowledgeSync.js
backend/src/ai/rag/vectorstores/jsonVectorStore.js
backend/tests/unit/aiFoundation.test.mjs
backend/tests/unit/aiChatService.test.mjs
backend/tests/unit/geminiProvider.test.mjs
backend/tests/unit/ragPhase3.test.mjs
backend/tests/unit/ragSync.test.mjs
backend/tests/unit/ragChatFlow.test.mjs
backend/tests/evaluation/phase3.dataset.mjs
backend/tests/evaluation/phase3.benchmark.mjs
backend/tests/fixtures/rag-phase2/bm25.js
backend/tests/fixtures/rag-phase2/hybridRetriever.js
backend/tests/fixtures/rag-phase2/queryRouter.js
backend/tests/fixtures/rag-phase2/contextBuilder.js
backend/tests/fixtures/rag-phase3-corpus.json
backend/reports/phase3/README.md
backend/reports/phase3/benchmark.json
backend/reports/phase3/triad-records.jsonl
backend/reports/phase3/verification.txt
frontend/src/types/ai.type.ts
frontend/src/hooks/useAIChat.ts
frontend/src/components/ai/AIChatMessage.tsx
```

`backend/src/controllers/product.controller.js`, Prisma và các file Auth/Checkout/Payment/Admin không được Phase 3 chỉnh sửa; các hook CRUD Phase 2 hiện có tiếp tục gọi knowledgeSync mới.
