-- Phase 3: Store Settings, CMS Pages, Footer Sections + Links
-- All changes are ADDITIVE — no DROP, no data loss.

-- ── Store Settings ────────────────────────────────────────────────────────────

CREATE TABLE `StoreSetting` (
  `key`       VARCHAR(100) NOT NULL,
  `value`     TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
);

-- ── CMS Content Pages ─────────────────────────────────────────────────────────

CREATE TABLE `ContentPage` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `slug`        VARCHAR(200) NOT NULL UNIQUE,
  `title`       VARCHAR(500) NOT NULL,
  `summary`     VARCHAR(1000) NULL,
  `content`     LONGTEXT NOT NULL,
  `seoTitle`    VARCHAR(500) NULL,
  `seoDesc`     VARCHAR(1000) NULL,
  `status`      ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `publishedAt` DATETIME(3) NULL,
  `createdById` INT NULL,
  `updatedById` INT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  INDEX `ContentPage_status_idx` (`status`),
  INDEX `ContentPage_slug_idx` (`slug`)
);

-- ── Footer ────────────────────────────────────────────────────────────────────

CREATE TABLE `FooterSection` (
  `id`        INT AUTO_INCREMENT PRIMARY KEY,
  `title`     VARCHAR(191) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `isActive`  BOOLEAN NOT NULL DEFAULT true,
  INDEX `FooterSection_isActive_sortOrder_idx` (`isActive`, `sortOrder`)
);

CREATE TABLE `FooterLink` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `sectionId`  INT NOT NULL,
  `label`      VARCHAR(191) NOT NULL,
  `linkType`   ENUM('INTERNAL_URL', 'EXTERNAL_URL', 'CMS_PAGE') NOT NULL DEFAULT 'INTERNAL_URL',
  `url`        VARCHAR(1000) NULL,
  `pageId`     INT NULL,
  `sortOrder`  INT NOT NULL DEFAULT 0,
  `isActive`   BOOLEAN NOT NULL DEFAULT true,
  `openNewTab` BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT `FooterLink_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `FooterSection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FooterLink_pageId_fkey`    FOREIGN KEY (`pageId`)    REFERENCES `ContentPage`(`id`)  ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `FooterLink_sectionId_isActive_sortOrder_idx` (`sectionId`, `isActive`, `sortOrder`),
  INDEX `FooterLink_pageId_idx` (`pageId`)
);

-- ── Seed: default Footer sections from current hardcoded Footer ───────────────
-- Idempotent: only inserts when table is empty.

INSERT INTO `FooterSection` (`title`, `sortOrder`, `isActive`) VALUES
  ('Giới thiệu',          0, true),
  ('Hỗ trợ khách hàng',  1, true),
  ('Chính sách chung',    2, true)
ON DUPLICATE KEY UPDATE `id` = `id`;

INSERT INTO `FooterLink` (`sectionId`, `label`, `linkType`, `url`, `sortOrder`, `isActive`, `openNewTab`)
SELECT s.id, l.label, 'INTERNAL_URL', l.url, l.sortOrder, true, false
FROM (
  SELECT 'Giới thiệu' AS sTitle, 'Giới thiệu DUCMANH PC' AS label, '/about'   AS url, 0 AS sortOrder UNION ALL
  SELECT 'Giới thiệu',           'Hệ thống cửa hàng',            '/stores',  1           UNION ALL
  SELECT 'Giới thiệu',           'Liên hệ hợp tác',              '/partner', 2           UNION ALL
  SELECT 'Hỗ trợ khách hàng',   'Hỏi đáp (FAQs)',               '/faq',     0           UNION ALL
  SELECT 'Hỗ trợ khách hàng',   'Hướng dẫn mua hàng',           '/guide',   1           UNION ALL
  SELECT 'Hỗ trợ khách hàng',   'Vận chuyển & Giao nhận',       '/shipping',2           UNION ALL
  SELECT 'Hỗ trợ khách hàng',   'Đổi trả & Hoàn tiền',          '/returns', 3           UNION ALL
  SELECT 'Hỗ trợ khách hàng',   'Hỗ trợ kỹ thuật',              '/support', 4           UNION ALL
  SELECT 'Chính sách chung',    'Chính sách bảo hành',          '/policy/warranty', 0   UNION ALL
  SELECT 'Chính sách chung',    'Chính sách đổi trả',           '/policy/return',   1   UNION ALL
  SELECT 'Chính sách chung',    'Chính sách bảo mật',           '/policy/privacy',  2   UNION ALL
  SELECT 'Chính sách chung',    'Điều khoản sử dụng',           '/policy/terms',    3   UNION ALL
  SELECT 'Chính sách chung',    'Chính sách thanh toán',        '/policy/payment',  4
) l
JOIN `FooterSection` s ON s.title = l.sTitle
WHERE NOT EXISTS (
  SELECT 1 FROM `FooterLink` fl WHERE fl.sectionId = s.id AND fl.label = l.label
);

-- ── Seed: default Store Settings ──────────────────────────────────────────────

INSERT INTO `StoreSetting` (`key`, `value`, `updatedAt`) VALUES
  ('store.name',          'DUCMANH PC',                                    NOW()),
  ('store.address',       '5 Lê Duẩn, Phường Xuân Hòa, Tỉnh Phú Thọ',  NOW()),
  ('store.phone',         '0386220065',                                    NOW()),
  ('store.email',         'luuducmanh.main@gmail.com',                    NOW()),
  ('store.logoUrl',       '/logo.png',                                     NOW()),
  ('social.facebook',     'https://www.facebook.com/ldmahz/',             NOW()),
  ('social.youtube',      'https://m.youtube.com/@ldmg5',                 NOW()),
  ('social.instagram',    'https://www.instagram.com/ldmahz',             NOW()),
  ('social.tiktok',       'https://www.tiktok.com/@ldmahz',              NOW()),
  ('footer.copyright',    '© {year} DUCMANH PC. All rights reserved.',   NOW()),
  ('footer.developer',    'Lưu Đức Mạnh',                                 NOW())
ON DUPLICATE KEY UPDATE `key` = `key`;
