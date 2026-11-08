/**
 * RAG Triad Evaluation — Test Cases
 * Bộ test case tiếng Việt cho đánh giá chatbot AI DUCMANH PC.
 *
 * Mỗi test case gồm:
 *   - query: câu hỏi người dùng
 *   - category: loại câu hỏi (product, policy, technical, comparison)
 *   - expectedTopics: chủ đề kỳ vọng trong câu trả lời
 *   - requiresTool: tool cần gọi (nếu có)
 */

export const TEST_CASES = [
  // === Product queries ===
  {
    id: 'prod-01',
    query: 'RTX 4060 giá bao nhiêu?',
    category: 'product',
    expectedTopics: ['giá', 'RTX 4060', 'tồn kho'],
    requiresTool: 'search_products',
  },
  {
    id: 'prod-02',
    query: 'Có laptop gaming nào dưới 20 triệu không?',
    category: 'product',
    expectedTopics: ['laptop', 'gaming', 'giá', 'dưới 20 triệu'],
    requiresTool: 'search_products',
  },
  {
    id: 'prod-03',
    query: 'RAM DDR5 16GB có những loại nào?',
    category: 'product',
    expectedTopics: ['RAM', 'DDR5', '16GB'],
    requiresTool: 'search_products',
  },
  {
    id: 'prod-04',
    query: 'Con card đắt nhất shop là gì?',
    category: 'product',
    expectedTopics: ['card', 'VGA', 'giá cao nhất'],
    requiresTool: 'search_products',
  },
  {
    id: 'prod-05',
    query: 'SSD 1TB NVMe còn hàng không?',
    category: 'product',
    expectedTopics: ['SSD', '1TB', 'NVMe', 'tồn kho'],
    requiresTool: 'search_products',
  },

  // === Policy queries ===
  {
    id: 'policy-01',
    query: 'Chính sách bảo hành của shop như nào?',
    category: 'policy',
    expectedTopics: ['bảo hành', 'thời gian', 'điều kiện'],
    requiresTool: null,
  },
  {
    id: 'policy-02',
    query: 'Có được đổi trả trong 7 ngày không?',
    category: 'policy',
    expectedTopics: ['đổi trả', 'thời hạn', 'điều kiện'],
    requiresTool: null,
  },
  {
    id: 'policy-03',
    query: 'Ship hàng về tỉnh mất bao lâu?',
    category: 'policy',
    expectedTopics: ['vận chuyển', 'thời gian', 'tỉnh'],
    requiresTool: null,
  },

  // === Technical queries ===
  {
    id: 'tech-01',
    query: 'DDR4 và DDR5 khác nhau thế nào?',
    category: 'technical',
    expectedTopics: ['DDR4', 'DDR5', 'khác biệt', 'tốc độ', 'giá'],
    requiresTool: null,
  },
  {
    id: 'tech-02',
    query: 'Mainboard B760 có hỗ trợ CPU Intel đời 14 không?',
    category: 'technical',
    expectedTopics: ['B760', 'Intel', 'gen 14', 'tương thích', 'socket'],
    requiresTool: null,
  },
  {
    id: 'tech-03',
    query: 'Nên chọn tản nhiệt khí hay tản nước AIO?',
    category: 'technical',
    expectedTopics: ['tản nhiệt', 'khí', 'AIO', 'nước', 'ưu nhược điểm'],
    requiresTool: null,
  },

  // === Comparison queries ===
  {
    id: 'comp-01',
    query: 'So sánh RTX 4060 với RTX 4060 Ti?',
    category: 'comparison',
    expectedTopics: ['RTX 4060', 'RTX 4060 Ti', 'hiệu năng', 'giá'],
    requiresTool: 'search_products',
  },
  {
    id: 'comp-02',
    query: 'Ryzen 5 7600X hay Core i5-14400F tốt hơn cho gaming?',
    category: 'comparison',
    expectedTopics: ['Ryzen 5 7600X', 'i5-14400F', 'gaming', 'hiệu năng'],
    requiresTool: 'search_products',
  },

  // === Out-of-domain queries ===
  {
    id: 'ood-01',
    query: 'Thời tiết hôm nay thế nào?',
    category: 'out_of_domain',
    expectedTopics: ['từ chối', 'không liên quan', 'hỗ trợ máy tính'],
    requiresTool: null,
  },
  {
    id: 'ood-02',
    query: 'Làm thế nào để nấu phở?',
    category: 'out_of_domain',
    expectedTopics: ['từ chối', 'không liên quan'],
    requiresTool: null,
  },
];
