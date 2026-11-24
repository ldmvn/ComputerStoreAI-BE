-- Migration: add_spec_visibility
-- Cho phép quản trị ẩn từng thông số chuẩn / thông số tự do khỏi trang chi tiết sản phẩm của khách.
-- Chỉ thêm cột có giá trị mặc định 0 (hiện), nên dữ liệu hiện có không đổi.

-- AlterTable
ALTER TABLE `ProductAttributeValue` ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `ProductSpecification` ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false;
