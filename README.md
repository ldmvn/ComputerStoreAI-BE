# ComputerStoreAI — Backend

REST API server cho hệ thống bán hàng máy tính **DUCMANHPC**, xây dựng trên Node.js và Express.js.

## Công nghệ sử dụng

- **Runtime:** Node.js
- **Framework:** Express.js
- **ORM:** Prisma
- **Database:** MySQL 8.0
- **Authentication:** JWT + Google OAuth 2.0
- **AI:** Claude, Deepseek (RAG, tư vấn mua hàng, Build PC)
- **Thanh toán:** VNPay, MoMo, SePay (chuyển khoản ngân hàng)
- **Upload:** Cloudinary + Local storage
- **Thông báo:** Telegram Bot API

## Cấu trúc thư mục

```
src/
├── ai/                 # Module AI (Gemini, RAG, Vector Search)
├── config/             # Cấu hình (database, OAuth, ...)
├── constants/          # Hằng số
├── controllers/        # Xử lý request/response
├── middlewares/        # Auth, RBAC, Rate Limit, Maintenance Mode
├── payments/           # Module thanh toán (VNPay, MoMo, SePay)
├── repositories/       # Truy vấn database
├── routes/             # Định tuyến API
├── services/           # Business logic
└── validators/         # Kiểm tra dữ liệu đầu vào
prisma/                 # Schema và migrations
tests/                  # Unit test và integration test
scripts/                # Scripts tiện ích
```

## Tính năng chính

- Quản lý sản phẩm, danh mục, thương hiệu
- Giỏ hàng, đặt hàng, theo dõi đơn hàng
- Thanh toán online (VNPay, MoMo, chuyển khoản QR)
- Đăng nhập / Đăng ký (JWT, Google OAuth)
- Phân quyền RBAC (Admin, Staff, Customer)
- AI tư vấn mua hàng (chatbot RAG)
- AI gợi ý Build PC
- Tìm kiếm sản phẩm (Full-text, gợi ý, trending)
- Đánh giá sản phẩm (có ảnh)
- Quản lý kho, khuyến mãi, voucher
- Mega Menu, Banner, SEO động
- Thông báo Telegram cho đơn hàng mới
- Rate Limiting, Maintenance Mode

## Cài đặt

```bash
# Clone repo
git clone https://github.com/ldmvn/ComputerStoreAI-BE.git
cd ComputerStoreAI-BE

# Cài đặt dependencies
npm install

# Tạo file .env từ template
cp .env.example .env
# Sửa các biến trong .env (DATABASE_URL, JWT_SECRET, ...)

# Tạo database và chạy migrations
npx prisma migrate deploy
npx prisma generate

# Chạy development server
npm run dev
```

Server sẽ chạy tại `http://localhost:5000`.

### Thư mục `uploads/` (ảnh sản phẩm, banner, logo, review)

`uploads/` nằm trong `.gitignore` nên **không có trong repo**. DB chỉ lưu đường dẫn dạng `/media/...`, nếu thiếu file thì ảnh sẽ hiện alt text. Sau khi clone cần copy/khôi phục thư mục này từ bản backup hoặc máy cũ vào `uploads/` (giữ nguyên cấu trúc `products/`, `brands/`, `banners/`, ...), hoặc trỏ `MEDIA_STORAGE_DIR` tới nơi chứa ảnh.

## API Endpoints

| Nhóm | Đường dẫn | Mô tả |
|------|-----------|-------|
| Auth | `/api/auth/*` | Đăng nhập, đăng ký, Google OAuth |
| Products | `/api/products/*` | CRUD sản phẩm |
| Orders | `/api/orders/*` | Đặt hàng, theo dõi đơn |
| Payments | `/api/payments/*` | Thanh toán VNPay, MoMo, SePay |
| Search | `/api/search/*` | Tìm kiếm, gợi ý, trending |
| AI Chat | `/api/ai/*` | Chatbot tư vấn mua hàng |
| Build PC | `/api/build-pc/*` | AI gợi ý cấu hình PC |
| Admin | `/api/admin/*` | Quản trị hệ thống |

## Scripts

```bash
npm run dev              # Chạy development server (nodemon)
npm start                # Chạy production server
npm run prisma:migrate   # Chạy database migration
npm run prisma:generate  # Generate Prisma Client
```
