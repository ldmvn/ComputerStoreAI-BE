-- Migration: add_promotional_sections
-- Additive only — no DROP TABLE, no DROP COLUMN, no data loss.
-- Extends ProductSection with SectionType enum and 13 promotional fields.
-- All NOT NULL columns have DEFAULT values so existing rows are unaffected.

-- AlterTable
ALTER TABLE `ProductSection`
    ADD COLUMN `type`        ENUM('PRODUCT_SECTION', 'PROMOTIONAL_SECTION') NOT NULL DEFAULT 'PRODUCT_SECTION',
    ADD COLUMN `badge`       VARCHAR(100)  NULL,
    ADD COLUMN `promoTitle`  VARCHAR(200)  NULL,
    ADD COLUMN `description` TEXT          NULL,
    ADD COLUMN `ctaEnabled`  BOOLEAN       NOT NULL DEFAULT true,
    ADD COLUMN `ctaLabel`    VARCHAR(100)  NULL,
    ADD COLUMN `ctaStyle`    VARCHAR(20)   NOT NULL DEFAULT 'primary',
    ADD COLUMN `ctaRounded`  VARCHAR(20)   NOT NULL DEFAULT 'pill',
    ADD COLUMN `ctaUrl`      VARCHAR(1000) NULL,
    ADD COLUMN `imageUrl`    VARCHAR(1000) NULL,
    ADD COLUMN `imageAlt`    VARCHAR(300)  NULL,
    ADD COLUMN `imagePos`    VARCHAR(20)   NOT NULL DEFAULT 'right',
    ADD COLUMN `colorPreset` VARCHAR(30)   NOT NULL DEFAULT 'dark-premium',
    ADD COLUMN `layout`      VARCHAR(30)   NOT NULL DEFAULT 'text-left-cta-right';
