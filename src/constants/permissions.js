// Canonical permission list — derived from actual backend modules.
// Each entry: { module, action, label, description }
// Modules map 1:1 to admin menu sections; actions are the 5 standard verbs.

export const PERMISSIONS = [
  // Dashboard
  { module: 'dashboard',      action: 'view',    label: 'Xem tổng quan',            description: 'Xem trang tổng quan hệ thống' },
  // Products
  { module: 'products',       action: 'view',    label: 'Xem sản phẩm',            description: 'Xem danh sách và chi tiết sản phẩm' },
  { module: 'products',       action: 'create',  label: 'Thêm sản phẩm',            description: 'Tạo sản phẩm mới' },
  { module: 'products',       action: 'update',  label: 'Sửa sản phẩm',             description: 'Chỉnh sửa thông tin sản phẩm' },
  { module: 'products',       action: 'delete',  label: 'Xóa sản phẩm',             description: 'Xóa sản phẩm khỏi hệ thống' },
  // Categories
  { module: 'categories',     action: 'view',    label: 'Xem danh mục',             description: 'Xem danh sách và cấu trúc danh mục' },
  { module: 'categories',     action: 'create',  label: 'Thêm danh mục',            description: 'Tạo danh mục mới' },
  { module: 'categories',     action: 'update',  label: 'Sửa danh mục',             description: 'Chỉnh sửa thông tin danh mục' },
  { module: 'categories',     action: 'delete',  label: 'Xóa danh mục',             description: 'Xóa danh mục' },
  // Brands
  { module: 'brands',         action: 'view',    label: 'Xem thương hiệu',          description: 'Xem danh sách thương hiệu' },
  { module: 'brands',         action: 'create',  label: 'Thêm thương hiệu',         description: 'Tạo thương hiệu mới' },
  { module: 'brands',         action: 'update',  label: 'Sửa thương hiệu',          description: 'Chỉnh sửa thông tin thương hiệu' },
  { module: 'brands',         action: 'delete',  label: 'Xóa thương hiệu',          description: 'Xóa thương hiệu' },
  // Attributes
  { module: 'attributes',     action: 'view',    label: 'Xem thuộc tính',           description: 'Xem danh sách thuộc tính và nhóm' },
  { module: 'attributes',     action: 'create',  label: 'Thêm thuộc tính',          description: 'Tạo thuộc tính và nhóm mới' },
  { module: 'attributes',     action: 'update',  label: 'Sửa thuộc tính',           description: 'Chỉnh sửa thuộc tính, nhóm và liên kết' },
  { module: 'attributes',     action: 'delete',  label: 'Xóa thuộc tính',           description: 'Xóa thuộc tính khỏi hệ thống' },
  // Mega Menu
  { module: 'megamenu',       action: 'view',    label: 'Xem Mega Menu',            description: 'Xem cấu hình Mega Menu' },
  { module: 'megamenu',       action: 'manage',  label: 'Quản lý Mega Menu',        description: 'Tạo, sửa, xóa mục Mega Menu' },
  // Inventory
  { module: 'inventory',      action: 'view',    label: 'Xem kho',                  description: 'Xem tồn kho và lịch sử điều chỉnh' },
  { module: 'inventory',      action: 'manage',  label: 'Quản lý kho',              description: 'Nhập kho, điều chỉnh tồn kho' },
  // Banners
  { module: 'banners',        action: 'view',    label: 'Xem banner',               description: 'Xem danh sách banner' },
  { module: 'banners',        action: 'create',  label: 'Thêm banner',              description: 'Tải lên và tạo banner mới' },
  { module: 'banners',        action: 'update',  label: 'Sửa banner',               description: 'Chỉnh sửa thông tin banner' },
  { module: 'banners',        action: 'delete',  label: 'Xóa banner',               description: 'Xóa banner' },
  // Product Sections
  { module: 'product_sections', action: 'view',  label: 'Xem khối sản phẩm',       description: 'Xem danh sách khối sản phẩm' },
  { module: 'product_sections', action: 'manage',label: 'Quản lý khối sản phẩm',   description: 'Tạo, sửa, xóa khối sản phẩm' },
  // Promotions
  { module: 'promotions',     action: 'view',    label: 'Xem khuyến mãi',           description: 'Xem danh sách mã giảm giá và khuyến mãi' },
  { module: 'promotions',     action: 'create',  label: 'Thêm khuyến mãi',          description: 'Tạo mã giảm giá mới' },
  { module: 'promotions',     action: 'update',  label: 'Sửa khuyến mãi',           description: 'Chỉnh sửa thông tin khuyến mãi' },
  { module: 'promotions',     action: 'delete',  label: 'Xóa khuyến mãi',           description: 'Xóa mã giảm giá' },
  // Reviews
  { module: 'reviews',        action: 'view',    label: 'Xem đánh giá',             description: 'Xem danh sách đánh giá sản phẩm' },
  { module: 'reviews',        action: 'manage',  label: 'Quản lý đánh giá',         description: 'Duyệt, ẩn, xóa đánh giá' },
  // Orders
  { module: 'orders',         action: 'view',    label: 'Xem đơn hàng',             description: 'Xem danh sách và chi tiết đơn hàng' },
  { module: 'orders',         action: 'update',  label: 'Cập nhật đơn hàng',        description: 'Thay đổi trạng thái đơn hàng' },
  { module: 'orders',         action: 'manage',  label: 'Quản lý đơn hàng',         description: 'Xử lý vận chuyển, hoàn tiền' },
  // Customers
  { module: 'customers',      action: 'view',    label: 'Xem khách hàng',           description: 'Xem danh sách và hồ sơ khách hàng' },
  { module: 'customers',      action: 'manage',  label: 'Quản lý khách hàng',       description: 'Khóa/mở khóa tài khoản khách hàng' },
  // Returns
  { module: 'returns',        action: 'view',    label: 'Xem yêu cầu đổi trả',      description: 'Xem danh sách yêu cầu đổi trả' },
  { module: 'returns',        action: 'manage',  label: 'Quản lý đổi trả',          description: 'Duyệt, từ chối, hoàn thành đổi trả' },
  // Reports
  { module: 'reports',        action: 'view',    label: 'Xem báo cáo',              description: 'Xem báo cáo doanh thu và thống kê' },
  // Build PC
  { module: 'build_pc',       action: 'view',    label: 'Xem Build PC',             description: 'Xem cấu hình Build PC' },
  { module: 'build_pc',       action: 'manage',  label: 'Quản lý Build PC',         description: 'Cấu hình nhóm linh kiện, tương thích, cài đặt' },
  // Administrators
  { module: 'administrators', action: 'view',    label: 'Xem quản trị viên',        description: 'Xem danh sách tài khoản quản trị' },
  { module: 'administrators', action: 'create',  label: 'Tạo quản trị viên',        description: 'Tạo tài khoản nhân viên/quản trị mới' },
  { module: 'administrators', action: 'update',  label: 'Sửa quản trị viên',        description: 'Chỉnh sửa thông tin tài khoản quản trị' },
  { module: 'administrators', action: 'manage',  label: 'Quản lý quản trị viên',    description: 'Khóa/mở khóa, gán vai trò, thu hồi phiên' },
  // Roles
  { module: 'roles',          action: 'view',    label: 'Xem vai trò',              description: 'Xem danh sách vai trò và phân quyền' },
  { module: 'roles',          action: 'create',  label: 'Tạo vai trò',              description: 'Tạo vai trò mới' },
  { module: 'roles',          action: 'update',  label: 'Sửa vai trò',              description: 'Sửa tên, mô tả và phân quyền vai trò' },
  { module: 'roles',          action: 'delete',  label: 'Xóa vai trò',              description: 'Xóa vai trò tùy chỉnh' },
  { module: 'roles',          action: 'manage',  label: 'Quản lý vai trò',          description: 'Toàn quyền quản lý vai trò và phân quyền' },
  // Activity Logs
  { module: 'activity_logs',  action: 'view',    label: 'Xem nhật ký hoạt động',    description: 'Xem nhật ký hành động quản trị' },
  // Settings
  { module: 'settings',       action: 'view',    label: 'Xem cài đặt cửa hàng',     description: 'Xem thông tin cửa hàng và cài đặt chung' },
  { module: 'settings',       action: 'manage',  label: 'Quản lý cài đặt cửa hàng', description: 'Chỉnh sửa thông tin cửa hàng, mạng xã hội, footer' },
  // Support Tickets
  { module: 'support',        action: 'view',    label: 'Xem phiếu hỗ trợ',         description: 'Xem danh sách và chi tiết phiếu hỗ trợ kỹ thuật' },
  { module: 'support',        action: 'reply',   label: 'Trả lời phiếu hỗ trợ',     description: 'Gửi phản hồi cho khách hàng trong phiếu hỗ trợ' },
  { module: 'support',        action: 'update',  label: 'Cập nhật trạng thái phiếu', description: 'Thay đổi trạng thái và ghi chú phiếu hỗ trợ' },
  { module: 'support',        action: 'assign',  label: 'Phân công xử lý',           description: 'Phân công nhân viên xử lý phiếu hỗ trợ' },
  { module: 'support',        action: 'manage',  label: 'Quản lý hỗ trợ',           description: 'Toàn quyền quản lý phiếu hỗ trợ, đóng, xóa' },
];

// Quick lookup helpers
export const PERM_MODULES = [...new Set(PERMISSIONS.map(p => p.module))];
export const permKey = (module, action) => `${module}:${action}`;
