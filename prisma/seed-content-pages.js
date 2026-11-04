// Idempotent seed for Phase 2 content pages.
// Run: node backend/prisma/seed-content-pages.js
// Skips any pageKey that already has a record in the DB.

import { prisma } from '../src/config/prisma.js';

const PAGES = [
  {
    pageKey: 'privacy',
    title: 'Chính sách bảo mật',
    description: 'Cách DUCMANH PC thu thập, sử dụng và bảo vệ thông tin cá nhân của khách hàng.',
    contentHtml: `<p style="color:#64748b;font-size:0.875rem;">Cập nhật lần cuối: 11/10/2026</p>

<h2 id="thu-thap">1. Thông tin chúng tôi thu thập</h2>
<p>Khi sử dụng dịch vụ của DUCMANH PC, chúng tôi có thể thu thập các thông tin sau:</p>
<ul>
<li><strong>Thông tin tài khoản:</strong> họ tên, địa chỉ email, số điện thoại.</li>
<li><strong>Thông tin giao hàng:</strong> địa chỉ nhận hàng.</li>
<li><strong>Thông tin giao dịch:</strong> lịch sử mua hàng, phương thức thanh toán.</li>
<li><strong>Thông tin thiết bị:</strong> địa chỉ IP, loại trình duyệt (qua cookie).</li>
</ul>

<h2 id="muc-dich">2. Mục đích sử dụng thông tin</h2>
<ul>
<li>Xử lý đơn hàng và giao hàng đến đúng địa chỉ.</li>
<li>Gửi thông báo về trạng thái đơn hàng, bảo hành và hỗ trợ khách hàng.</li>
<li>Cải thiện trải nghiệm mua sắm và phát triển tính năng website.</li>
<li>Gửi thông tin khuyến mãi (khi khách hàng đồng ý đăng ký nhận tin).</li>
</ul>

<h2 id="chia-se">3. Chia sẻ thông tin với bên thứ ba</h2>
<p>DUCMANH PC không bán, trao đổi hoặc chuyển nhượng thông tin cá nhân của khách hàng cho bên thứ ba, ngoại trừ:</p>
<ul>
<li>Đơn vị vận chuyển để thực hiện giao hàng.</li>
<li>Cổng thanh toán để xử lý giao dịch (không lưu trữ thông tin thẻ).</li>
<li>Yêu cầu từ cơ quan pháp luật có thẩm quyền.</li>
</ul>

<h2 id="bao-mat">4. Bảo mật dữ liệu</h2>
<p>Thông tin của khách hàng được bảo vệ bằng các biện pháp kỹ thuật phù hợp, bao gồm mã hóa mật khẩu và kết nối HTTPS. Chúng tôi không lưu trữ thông tin thẻ tín dụng trực tiếp trên hệ thống.</p>

<h2 id="quyen">5. Quyền của khách hàng</h2>
<ul>
<li>Truy cập và cập nhật thông tin cá nhân trong tài khoản.</li>
<li>Yêu cầu xóa tài khoản và dữ liệu liên quan.</li>
<li>Hủy đăng ký nhận email quảng cáo bất kỳ lúc nào.</li>
<li>Liên hệ để khiếu nại về việc sử dụng dữ liệu.</li>
</ul>

<h2 id="cookie">6. Cookie</h2>
<p>Website sử dụng cookie để lưu giỏ hàng, trạng thái đăng nhập và cải thiện trải nghiệm duyệt web. Bạn có thể tắt cookie trong cài đặt trình duyệt, tuy nhiên một số tính năng có thể bị ảnh hưởng.</p>

<h2 id="lien-he">7. Liên hệ về quyền riêng tư</h2>
<ul>
<li>📧 Email: <a href="mailto:luuducmanh.main@gmail.com">luuducmanh.main@gmail.com</a></li>
<li>📞 Hotline: <a href="tel:0386220065">0386220065</a></li>
</ul>`,
  },
  {
    pageKey: 'return',
    title: 'Chính sách đổi trả',
    description: 'Điều kiện, quy trình đổi trả và hoàn tiền khi mua sắm tại DUCMANH PC.',
    contentHtml: `<p style="color:#64748b;font-size:0.875rem;">Cập nhật lần cuối: 11/10/2026</p>

<h2 id="dieu-kien">1. Điều kiện đổi trả</h2>
<ul>
<li>Sản phẩm còn nguyên hộp, tem niêm phong, phụ kiện đầy đủ như lúc mua.</li>
<li>Có hóa đơn mua hàng hợp lệ từ DUCMANH PC.</li>
<li>Sản phẩm không có dấu hiệu đã qua sử dụng, trầy xước hoặc hư hỏng do người dùng.</li>
<li>Lỗi thuộc về nhà sản xuất hoặc giao sai sản phẩm so với đơn đặt hàng.</li>
</ul>

<h2 id="thoi-han">2. Thời hạn đổi trả</h2>
<p>Khách hàng có quyền yêu cầu đổi/trả trong vòng 7 ngày kể từ ngày nhận hàng, với điều kiện sản phẩm còn nguyên vẹn và đáp ứng các điều kiện nêu trên.</p>

<h2 id="hang-khong-doi">3. Sản phẩm không áp dụng đổi trả</h2>
<ul>
<li>Sản phẩm đã được kích hoạt bản quyền phần mềm.</li>
<li>Sản phẩm bị hư hỏng do lỗi người dùng.</li>
<li>Sản phẩm trong chương trình khuyến mãi đặc biệt có ghi rõ "Không đổi trả".</li>
<li>Vật tư tiêu hao (pin, mực in, v.v.).</li>
</ul>

<h2 id="quy-trinh">4. Quy trình đổi trả</h2>
<ol>
<li>Liên hệ DUCMANH PC qua hotline hoặc email để thông báo yêu cầu đổi/trả.</li>
<li>Cung cấp hóa đơn mua hàng và mô tả tình trạng sản phẩm.</li>
<li>Gửi sản phẩm về cửa hàng (hoặc mang trực tiếp).</li>
<li>Nhân viên kiểm tra và xác nhận yêu cầu trong 3–5 ngày làm việc.</li>
<li>Đổi sản phẩm mới hoặc hoàn tiền theo thỏa thuận.</li>
</ol>

<h2 id="hoan-tien">5. Chính sách hoàn tiền</h2>
<p>Trong trường hợp sản phẩm lỗi mà không có hàng đổi, DUCMANH PC sẽ hoàn tiền theo hình thức:</p>
<ul>
<li>Chuyển khoản ngân hàng trong vòng 3–5 ngày làm việc sau khi xác nhận.</li>
<li>Hoàn tiền mặt tại cửa hàng (áp dụng khi khách mang trực tiếp).</li>
</ul>

<h2 id="lien-he">6. Liên hệ</h2>
<ul>
<li>📞 Hotline: <a href="tel:0386220065">0386220065</a></li>
<li>📧 Email: <a href="mailto:luuducmanh.main@gmail.com">luuducmanh.main@gmail.com</a></li>
<li>📍 Địa chỉ: 5 Lê Duẩn, Phường Xuân Hòa, Tỉnh Phú Thọ</li>
</ul>`,
  },
  {
    pageKey: 'terms',
    title: 'Điều khoản sử dụng',
    description: 'Các điều khoản và điều kiện sử dụng dịch vụ, website DUCMANH PC.',
    contentHtml: `<p style="color:#64748b;font-size:0.875rem;">Cập nhật lần cuối: 11/10/2026</p>

<h2 id="chap-nhan">1. Chấp nhận điều khoản</h2>
<p>Bằng việc truy cập và sử dụng website DUCMANH PC, bạn đồng ý tuân thủ và bị ràng buộc bởi các điều khoản và điều kiện được quy định dưới đây.</p>

<h2 id="dich-vu">2. Sử dụng dịch vụ</h2>
<p>Website DUCMANH PC được sử dụng cho mục đích mua sắm hợp pháp. Người dùng không được:</p>
<ul>
<li>Sử dụng website cho mục đích gian lận, lừa đảo hoặc vi phạm pháp luật.</li>
<li>Cố ý làm ảnh hưởng đến hoạt động của hệ thống.</li>
<li>Thu thập thông tin của người dùng khác mà không có sự đồng ý.</li>
</ul>

<h2 id="tai-khoan">3. Tài khoản người dùng</h2>
<p>Bạn chịu trách nhiệm bảo mật thông tin đăng nhập tài khoản. DUCMANH PC không chịu trách nhiệm về mọi hậu quả phát sinh từ việc để lộ thông tin tài khoản của bạn.</p>

<h2 id="don-hang">4. Đặt hàng &amp; Thanh toán</h2>
<p>Mọi đơn hàng đặt qua website đều cần được xác nhận bởi DUCMANH PC. Chúng tôi có quyền từ chối hoặc hủy đơn hàng trong trường hợp thông tin không hợp lệ hoặc hàng hóa không còn hàng.</p>

<h2 id="so-huu-tri-tue">5. Sở hữu trí tuệ</h2>
<p>Toàn bộ nội dung trên website bao gồm logo, hình ảnh, văn bản và thiết kế là tài sản của DUCMANH PC hoặc đối tác cung cấp. Nghiêm cấm sao chép, phân phối hoặc sử dụng thương mại khi chưa có sự cho phép.</p>

<h2 id="gioi-han">6. Giới hạn trách nhiệm</h2>
<p>DUCMANH PC không chịu trách nhiệm về các thiệt hại gián tiếp phát sinh từ việc sử dụng dịch vụ, bao gồm nhưng không giới hạn ở mất dữ liệu hoặc gián đoạn kinh doanh.</p>

<h2 id="thay-doi">7. Thay đổi điều khoản</h2>
<p>DUCMANH PC có quyền cập nhật các điều khoản này vào bất kỳ lúc nào. Thay đổi có hiệu lực kể từ khi được đăng tải lên website. Việc tiếp tục sử dụng dịch vụ đồng nghĩa với việc bạn chấp nhận điều khoản mới.</p>`,
  },
  {
    pageKey: 'payment',
    title: 'Chính sách thanh toán',
    description: 'Các phương thức thanh toán, bảo mật giao dịch và chính sách hoàn tiền tại DUCMANH PC.',
    contentHtml: `<p style="color:#64748b;font-size:0.875rem;">Cập nhật lần cuối: 11/10/2026</p>

<h2 id="phuong-thuc">1. Phương thức thanh toán được chấp nhận</h2>
<h3>💵 Thanh toán khi nhận hàng (COD)</h3>
<p>Thanh toán bằng tiền mặt trực tiếp cho nhân viên giao hàng khi nhận sản phẩm.</p>
<h3>🏦 Chuyển khoản ngân hàng</h3>
<p>Chuyển khoản theo thông tin tài khoản được cung cấp sau khi đặt hàng.</p>
<h3>📱 Ví MoMo</h3>
<p>Thanh toán qua ví điện tử MoMo.</p>
<h3>💳 VNPAY / Thẻ ngân hàng</h3>
<p>Thanh toán qua cổng VNPAY, hỗ trợ thẻ ATM nội địa và thẻ quốc tế.</p>

<h2 id="bao-mat">2. Bảo mật thanh toán</h2>
<p>Mọi giao dịch qua cổng thanh toán điện tử được mã hóa SSL. DUCMANH PC không lưu trữ thông tin thẻ tín dụng/ghi nợ của khách hàng trên hệ thống.</p>

<h2 id="xac-nhan">3. Xác nhận đơn hàng</h2>
<p>Sau khi thanh toán thành công, khách hàng sẽ nhận được xác nhận qua email. Đơn hàng được xử lý trong vòng 1–2 ngày làm việc sau khi thanh toán được xác nhận.</p>

<h2 id="hoan-tien">4. Hoàn tiền</h2>
<p>Trường hợp đơn hàng bị hủy sau khi đã thanh toán hoặc sản phẩm lỗi không có hàng đổi, DUCMANH PC sẽ hoàn tiền trong vòng 3–5 ngày làm việc qua phương thức thanh toán ban đầu hoặc chuyển khoản ngân hàng.</p>`,
  },
  {
    pageKey: 'shipping',
    title: 'Vận chuyển & Giao nhận',
    description: 'Phạm vi giao hàng, thời gian, phí vận chuyển và hướng dẫn khi nhận hàng từ DUCMANH PC.',
    contentHtml: `<h2 id="pham-vi">1. Phạm vi giao hàng</h2>
<p>DUCMANH PC giao hàng trên toàn lãnh thổ Việt Nam, bao gồm các tỉnh thành, huyện, xã có dịch vụ bưu chính/vận chuyển.</p>
<p>Với các khu vực vùng sâu, vùng xa hoặc hải đảo, thời gian giao hàng có thể kéo dài hơn. Vui lòng liên hệ để xác nhận trước khi đặt hàng.</p>

<h2 id="thoi-gian">2. Thời gian giao hàng dự kiến</h2>
<table>
<thead>
<tr><th>Khu vực</th><th>Thời gian dự kiến</th></tr>
</thead>
<tbody>
<tr><td>Nội tỉnh Phú Thọ</td><td>1–2 ngày làm việc</td></tr>
<tr><td>Hà Nội, các tỉnh lân cận</td><td>1–3 ngày làm việc</td></tr>
<tr><td>Miền Trung</td><td>3–5 ngày làm việc</td></tr>
<tr><td>Miền Nam</td><td>3–6 ngày làm việc</td></tr>
<tr><td>Vùng sâu, vùng xa, hải đảo</td><td>Liên hệ xác nhận</td></tr>
</tbody>
</table>
<p><em>* Thời gian trên tính từ khi đơn hàng được xác nhận và không tính ngày lễ, Tết.</em></p>

<h2 id="phi">3. Phí vận chuyển</h2>
<p>Phí vận chuyển được tính dựa trên khối lượng, kích thước sản phẩm và khu vực giao hàng. Phí chính xác sẽ hiển thị tại bước thanh toán sau khi bạn nhập địa chỉ.</p>
<p>Một số chương trình khuyến mãi có thể bao gồm miễn phí vận chuyển. Chi tiết ghi rõ trong từng chương trình.</p>

<h2 id="don-vi">4. Đơn vị vận chuyển</h2>
<p>DUCMANH PC hợp tác với các đơn vị vận chuyển uy tín như: Giao Hàng Nhanh (GHN), Giao Hàng Tiết Kiệm (GHTK), J&amp;T Express, Viettel Post.</p>
<p>Tùy theo khu vực và trọng lượng hàng hóa, đơn vị vận chuyển phù hợp sẽ được tự động chỉ định.</p>

<h2 id="nhan-hang">5. Khi nhận hàng</h2>
<ul>
<li>Kiểm tra bao bì bên ngoài và tem niêm phong trước khi ký nhận.</li>
<li>Nếu phát hiện bao bì rách, móp méo hoặc dấu hiệu bất thường, ghi chú vào biên bản giao hàng và liên hệ ngay với DUCMANH PC.</li>
<li>Từ chối nhận hàng nếu sản phẩm bị hư hỏng rõ ràng do vận chuyển.</li>
<li>Quay video khi mở hộp để làm bằng chứng trong trường hợp cần khiếu nại.</li>
</ul>

<h2 id="theo-doi">6. Theo dõi đơn hàng</h2>
<p>Sau khi đơn hàng được xuất kho, bạn sẽ nhận thông báo kèm mã vận đơn qua email. Đăng nhập tài khoản và vào "Đơn hàng của tôi" để xem trạng thái cập nhật.</p>`,
  },
  {
    pageKey: 'about',
    title: 'Giới thiệu DUCMANH PC',
    description: 'Câu chuyện thành lập, giá trị cốt lõi và danh mục sản phẩm của DUCMANH PC.',
    contentHtml: `<h2 id="cau-chuyen">Câu chuyện của chúng tôi</h2>
<p>DUCMANH PC ra đời với sứ mệnh đơn giản: mang đến cho người dùng tại Phú Thọ và toàn quốc những sản phẩm công nghệ chính hãng, giá tốt và dịch vụ thực sự tận tâm.</p>
<p>Chúng tôi tin rằng công nghệ không chỉ là công cụ, mà là người bạn đồng hành trong học tập, làm việc và sáng tạo. Vì vậy, DUCMANH PC không chỉ bán sản phẩm — chúng tôi tư vấn, hỗ trợ và đồng hành cùng khách hàng trong suốt vòng đời sản phẩm.</p>

<h2 id="gia-tri">Giá trị cốt lõi</h2>
<h3>Sản phẩm chính hãng</h3>
<p>Toàn bộ sản phẩm được nhập từ các nhà phân phối chính thức, đảm bảo nguồn gốc rõ ràng và tem bảo hành hợp lệ.</p>
<h3>Tư vấn chuyên sâu</h3>
<p>Đội ngũ kỹ thuật viên hiểu sâu về cấu hình PC, sẵn sàng tư vấn lắp máy phù hợp nhu cầu và ngân sách.</p>
<h3>Hỗ trợ sau bán hàng</h3>
<p>Hỗ trợ kỹ thuật, bảo hành và sửa chữa tại cửa hàng. Khách hàng không bao giờ phải tự xử lý một mình.</p>
<h3>Khách hàng là trung tâm</h3>
<p>Mọi quyết định đều xuất phát từ lợi ích của khách hàng — từ giá cả đến dịch vụ và chính sách đổi trả.</p>

<h2 id="san-pham">Sản phẩm &amp; Dịch vụ</h2>
<p>DUCMANH PC cung cấp đầy đủ các sản phẩm công nghệ bao gồm:</p>
<ul>
<li>Máy tính xách tay (Laptop) các thương hiệu Asus, Dell, HP, Lenovo, Acer, MSI…</li>
<li>Máy tính để bàn (Desktop PC) nguyên bộ và linh kiện rời.</li>
<li>Màn hình, bàn phím, chuột, tai nghe và phụ kiện gaming.</li>
<li>Thiết bị mạng, ổ cứng, RAM, card đồ họa và linh kiện nâng cấp.</li>
<li>Dịch vụ lắp đặt, tư vấn cấu hình và bảo trì máy tính.</li>
</ul>

<h2 id="lien-he">Liên hệ</h2>
<p><strong>Đến thăm cửa hàng của chúng tôi</strong></p>
<p>📍 5 Lê Duẩn, Phường Xuân Hòa, Tỉnh Phú Thọ</p>
<p>📞 <a href="tel:0386220065">0386220065</a></p>`,
  },
  {
    pageKey: 'guide',
    title: 'Hướng dẫn mua hàng',
    description: 'Hướng dẫn từng bước đặt hàng trực tuyến tại DUCMANH PC một cách dễ dàng.',
    contentHtml: `<h2 id="chon-sp">01 — Chọn sản phẩm</h2>
<p>Duyệt sản phẩm theo danh mục hoặc tìm kiếm theo tên. Xem thông số kỹ thuật, hình ảnh và đánh giá từ người dùng khác trước khi quyết định.</p>
<ul>
<li>Dùng bộ lọc để thu hẹp kết quả theo giá, thương hiệu, cấu hình.</li>
<li>So sánh nhiều sản phẩm cùng lúc ở trang chi tiết.</li>
<li>Thêm vào Yêu thích để lưu sản phẩm xem lại sau.</li>
</ul>

<h2 id="gio-hang">02 — Thêm vào giỏ hàng</h2>
<p>Nhấn "Thêm vào giỏ hàng" hoặc "Mua ngay" trên trang chi tiết sản phẩm. Kiểm tra lại số lượng và danh sách sản phẩm trong giỏ trước khi đặt.</p>
<ul>
<li>Chọn tick (✓) từng sản phẩm muốn mua trong giỏ hàng.</li>
<li>Tổng tiền được tính tự động theo các sản phẩm đã chọn.</li>
</ul>

<h2 id="thanh-toan">03 — Thanh toán</h2>
<p>Điền địa chỉ giao hàng, chọn phương thức vận chuyển và thanh toán. Kiểm tra lại thông tin đơn hàng trước khi xác nhận.</p>
<ul>
<li>Đảm bảo địa chỉ giao hàng chính xác để tránh giao nhầm.</li>
<li>Chọn phương thức thanh toán phù hợp: COD, chuyển khoản, MoMo, VNPAY.</li>
</ul>

<h2 id="nhan-hang">04 — Nhận hàng</h2>
<p>Sau khi đặt hàng thành công, bạn sẽ nhận email xác nhận. Theo dõi trạng thái đơn hàng trong tài khoản. Kiểm tra sản phẩm kỹ trước khi ký nhận.</p>
<ul>
<li>Kiểm tra bao bì và tem niêm phong trước khi nhận.</li>
<li>Nếu sản phẩm bị hỏng hóc, từ chối nhận và liên hệ ngay với DUCMANH PC.</li>
</ul>

<h2 id="ho-tro">Cần hỗ trợ thêm?</h2>
<p>Liên hệ tư vấn viên qua hotline <a href="tel:0386220065">0386220065</a> để được hỗ trợ chọn cấu hình phù hợp.</p>
<p>Xem thêm: <a href="/shipping">Vận chuyển &amp; Giao nhận</a> | <a href="/policy/payment">Chính sách thanh toán</a></p>`,
  },
];

async function main() {
  console.log('Seeding content pages (idempotent — skips existing records)…');

  for (const page of PAGES) {
    const existing = await prisma.policyPage.findUnique({ where: { pageKey: page.pageKey } });
    if (existing) {
      console.log(`  SKIP  ${page.pageKey} (already exists)`);
      continue;
    }
    await prisma.policyPage.create({ data: page });
    console.log(`  CREATE ${page.pageKey}`);
  }

  console.log('Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
