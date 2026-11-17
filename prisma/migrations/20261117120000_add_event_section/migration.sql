-- Migration: add_event_section
-- Thêm loại khối "sự kiện" (flash sale) cho trang chủ. Chỉ thêm: một giá trị enum và 4 cột có giá trị mặc định
-- hoặc cho phép NULL, nên các khối hiện có không bị ảnh hưởng.

-- AlterTable
ALTER TABLE `ProductSection`
    MODIFY `type` ENUM('PRODUCT_SECTION', 'PROMOTIONAL_SECTION', 'EVENT_SECTION') NOT NULL DEFAULT 'PRODUCT_SECTION',
    ADD COLUMN `eventTheme` VARCHAR(30) NOT NULL DEFAULT 'nha-giao',
    ADD COLUMN `eventIcon`  VARCHAR(20) NOT NULL DEFAULT 'cap',
    ADD COLUMN `startsAt`   DATETIME(3) NULL,
    ADD COLUMN `endsAt`     DATETIME(3) NULL;
