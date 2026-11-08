// What each storefront page does, in the words the chatbot may use. Keys are the closed set the
// frontend sends as `pageKey`; anything else from a client is ignored, never put into a prompt.
// Keep descriptions in sync with the real pages under frontend src/app (customer routes).
export const PAGE_CONTEXT = {
  home: {
    name: 'Trang chủ',
    description: 'Trang chủ DUCMANH PC với banner khuyến mãi, danh mục sản phẩm và các nhóm sản phẩm nổi bật.',
    nextActions: 'chọn một danh mục hoặc dùng ô tìm kiếm trên đầu trang để tìm sản phẩm, hoặc cho mình biết nhu cầu để mình tư vấn',
  },
  product_list: {
    name: 'Danh sách sản phẩm',
    description: 'Duyệt sản phẩm theo danh mục, thương hiệu; có bộ lọc và sắp xếp (mới nhất, giá thấp đến cao, giá cao đến thấp, tên A đến Z).',
    nextActions: 'dùng bộ lọc để thu hẹp kết quả rồi mở một sản phẩm để xem chi tiết, hoặc cho mình biết ngân sách để mình gợi ý',
  },
  product_detail: {
    name: 'Chi tiết sản phẩm',
    description: 'Xem ảnh, giá, tình trạng còn hàng, thông số, mô tả, khuyến mãi và đánh giá của một sản phẩm; có thể thêm vào giỏ hàng hoặc lưu vào yêu thích.',
    nextActions: 'hỏi mình về giá, tồn kho, bảo hành hoặc so sánh sản phẩm này với sản phẩm khác, hoặc thêm vào giỏ hàng nếu ưng ý',
  },
  search: {
    name: 'Kết quả tìm kiếm',
    description: 'Danh sách sản phẩm khớp với từ khóa bạn vừa tìm, có thể lọc và sắp xếp.',
    nextActions: 'mở một sản phẩm để xem chi tiết hoặc thử từ khóa khác; mình cũng có thể giúp tìm theo ngân sách và nhu cầu',
  },
  cart: {
    name: 'Giỏ hàng',
    description: 'Xem lại các sản phẩm đã thêm, chỉnh số lượng hoặc xóa sản phẩm, và xem tạm tính, tổng giỏ hàng trước khi thanh toán.',
    nextActions: 'kiểm tra lại số lượng rồi chuyển sang bước thanh toán, hoặc hỏi mình nếu cần kiểm tra tương thích linh kiện trong giỏ',
  },
  checkout: {
    name: 'Thanh toán',
    description: 'Chọn địa chỉ giao hàng, nhập mã giảm giá, chọn phương thức thanh toán (COD, chuyển khoản VietQR, MoMo, VNPAY tùy cấu hình cửa hàng), ghi chú đơn hàng, xem phí vận chuyển và tổng thanh toán rồi bấm Đặt hàng.',
    nextActions: 'kiểm tra địa chỉ, mã giảm giá và phương thức thanh toán rồi bấm Đặt hàng; mình có thể giải thích chính sách thanh toán hoặc vận chuyển nếu bạn cần',
  },
  order_history: {
    name: 'Đơn hàng của tôi',
    description: 'Xem và tìm kiếm các đơn hàng đã đặt, theo dõi trạng thái từng đơn và mở chi tiết đơn.',
    nextActions: 'mở một đơn để xem tiến trình, hoặc nhờ mình tra cứu tình trạng đơn hàng giúp bạn (cần đăng nhập)',
  },
  order_detail: {
    name: 'Chi tiết đơn hàng',
    description: 'Xem thông tin đơn, tiến trình đơn hàng, địa chỉ giao và chi tiết thanh toán; có thể đổi phương thức thanh toán, hủy đơn khi còn được phép và đánh giá sản phẩm sau khi nhận hàng.',
    nextActions: 'theo dõi tiến trình đơn, hoặc nhờ mình tra cứu tình trạng đơn hàng và giải thích chính sách đổi trả, bảo hành',
  },
  wishlist: {
    name: 'Yêu thích',
    description: 'Danh sách các sản phẩm bạn đã lưu để xem lại sau (cần đăng nhập).',
    nextActions: 'mở sản phẩm để xem lại giá và tình trạng hàng, hoặc nhờ mình so sánh các sản phẩm đã lưu',
  },
  build_pc: {
    name: 'Build PC',
    description: 'Tự chọn linh kiện cho từng vị trí (CPU, mainboard, RAM, ổ cứng, nguồn, case...), hệ thống kiểm tra tương thích, hiển thị tổng giá, cho thêm cả cấu hình vào giỏ hàng và chia sẻ cấu hình bằng liên kết. Ngoài ra có lựa chọn "Tối ưu cùng AI" để AI đề xuất cấu hình.',
    nextActions: 'chọn linh kiện cho từng vị trí và xem kết quả kiểm tra tương thích, hoặc cho mình biết ngân sách và nhu cầu để mình gợi ý linh kiện',
  },
  ai_build_pc: {
    name: 'Tối ưu cùng AI (AI Build PC)',
    description: 'Nhập nhu cầu và ngân sách (ví dụ "máy chơi Valorant, màn 2K, tầm 25 triệu") hoặc chọn nhanh nhu cầu; AI đề xuất cấu hình theo 3 bản (Tiết kiệm, Cân bằng, Hiệu năng cao) kèm FPS dự kiến và kiểm tra tương thích, cho phép yêu cầu AI chỉnh lại (ví dụ đổi sang CPU Intel) rồi thêm vào giỏ hàng.',
    nextActions: 'nhập nhu cầu cùng ngân sách để AI tạo cấu hình, rồi xem các bản đề xuất và thêm bản ưng ý vào giỏ',
  },
  account: {
    name: 'Tài khoản',
    description: 'Quản lý hồ sơ cá nhân, địa chỉ giao hàng, đổi mật khẩu, xem đánh giá của tôi và các yêu cầu hỗ trợ (cần đăng nhập).',
    nextActions: 'cập nhật thông tin hoặc địa chỉ giao hàng, hoặc vào Đơn hàng của tôi để theo dõi đơn',
  },
  auth: {
    name: 'Đăng nhập / đăng ký',
    description: 'Đăng nhập hoặc lấy lại mật khẩu để dùng giỏ hàng, đơn hàng và các tính năng cần tài khoản.',
    nextActions: 'đăng nhập để xem đơn hàng và lưu sản phẩm yêu thích; mình vẫn tư vấn sản phẩm được cả khi chưa đăng nhập',
  },
  policy: {
    name: 'Trang thông tin cửa hàng',
    description: 'Các trang thông tin của DUCMANH PC: chính sách (bảo hành, đổi trả, thanh toán, bảo mật, điều khoản), vận chuyển, hướng dẫn mua hàng và câu hỏi thường gặp.',
    nextActions: 'đọc mục bạn quan tâm, hoặc hỏi thẳng mình về chính sách bảo hành, đổi trả, thanh toán hay vận chuyển',
  },
};

export const PAGE_KEYS = new Set([...Object.keys(PAGE_CONTEXT), 'other']);

// Returns null for `other`, missing or unknown keys (the bot then admits it cannot tell the page).
export function getPageContext(pageKey) {
  return typeof pageKey === 'string' && Object.hasOwn(PAGE_CONTEXT, pageKey) ? PAGE_CONTEXT[pageKey] : null;
}

export function pageLinePrompt(page) {
  return `\nKhách đang ở trang: ${page.name}. Chức năng: ${page.description}\n` +
    'Nếu khách hỏi về trang hiện tại ("tôi đang ở trang nào", "trang này làm được gì"...), trả lời ngắn gọn dựa trên mô tả này, kèm đúng một gợi ý bước tiếp theo, ví dụ: ' + page.nextActions + '. ' +
    'Khách có thể vừa chuyển trang nên trang ở các lượt trước có thể khác; luôn trả lời theo trang hiện tại, không xin lỗi hay đính chính về các lượt trước.';
}
