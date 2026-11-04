// Idempotent seed — only inserts if no record exists for pageKey 'warranty'.
// Run with: node backend/prisma/seed-content-warranty.js
// Does NOT overwrite content already edited by admins.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WARRANTY_HTML = `<p>Cập nhật lần cuối: 11/10/2026</p>
<h2>1. Phạm vi áp dụng</h2>
<p>Chính sách bảo hành áp dụng cho tất cả sản phẩm được mua tại DUCMANH PC — bao gồm mua trực tiếp tại cửa hàng và đặt hàng qua website.</p>
<p>Mỗi sản phẩm đều được kèm theo phiếu bảo hành hoặc ghi nhận bảo hành điện tử theo từng danh mục hàng hóa.</p>
<h2>2. Thời gian bảo hành</h2>
<p>Thời gian bảo hành phụ thuộc vào từng nhà sản xuất và danh mục sản phẩm. Khách hàng vui lòng kiểm tra phiếu bảo hành hoặc liên hệ cửa hàng để biết chính xác thời hạn.</p>
<ul><li>Máy tính xách tay (Laptop): 12–24 tháng theo nhà sản xuất</li><li>Máy tính để bàn (PC): 24 tháng theo nhà sản xuất</li><li>Linh kiện, phụ kiện: 12–36 tháng theo nhà sản xuất</li><li>Màn hình: 24 tháng theo nhà sản xuất</li></ul>
<h2>3. Điều kiện bảo hành hợp lệ</h2>
<ul><li>Sản phẩm còn trong thời hạn bảo hành.</li><li>Còn hóa đơn mua hàng hoặc phiếu bảo hành hợp lệ từ DUCMANH PC.</li><li>Sản phẩm bị lỗi do nhà sản xuất, không phải do người dùng tác động.</li><li>Tem bảo hành (nếu có) còn nguyên vẹn, không bị rách hoặc tẩy xóa.</li></ul>
<h2>4. Trường hợp không được bảo hành</h2>
<ul><li>Sản phẩm bị hư hỏng do tác động vật lý: va đập, rơi vỡ, bị nước vào.</li><li>Sản phẩm đã qua sửa chữa tại đơn vị khác ngoài hệ thống bảo hành chính hãng.</li><li>Sản phẩm bị oxy hóa, cháy nổ do nguồn điện không ổn định hoặc sử dụng sai cách.</li><li>Hết thời hạn bảo hành.</li></ul>
<h2>5. Quy trình thực hiện bảo hành</h2>
<ol><li>Khách hàng liên hệ DUCMANH PC qua hotline hoặc đến trực tiếp cửa hàng.</li><li>Nhân viên kiểm tra tình trạng sản phẩm và xác nhận điều kiện bảo hành.</li><li>Sản phẩm được gửi đến trung tâm bảo hành chính hãng (nếu cần).</li><li>Khách hàng nhận lại sản phẩm sau khi hoàn tất bảo hành. Thời gian xử lý: 3–5 ngày làm việc.</li></ol>
<h2>6. Liên hệ hỗ trợ bảo hành</h2>
<ul><li>📞 Hotline: <a href="tel:0386220065">0386220065</a></li><li>📧 Email: <a href="mailto:luuducmanh.main@gmail.com">luuducmanh.main@gmail.com</a></li><li>📍 Địa chỉ: 5 Lê Duẩn, Phường Xuân Hòa, Tỉnh Phú Thọ</li></ul>`;

async function main() {
  const existing = await prisma.policyPage.findUnique({ where: { pageKey: 'warranty' } });

  if (existing) {
    console.log('[seed-content-warranty] Record already exists — skipping (preserving admin edits).');
    return;
  }

  await prisma.policyPage.create({
    data: {
      pageKey:     'warranty',
      title:       'Chính sách bảo hành',
      description: 'DUCMANH PC cam kết hỗ trợ bảo hành nhanh chóng, minh bạch và đúng cam kết cho mọi sản phẩm.',
      contentHtml: WARRANTY_HTML,
    },
  });

  console.log('[seed-content-warranty] Warranty content seeded successfully.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
