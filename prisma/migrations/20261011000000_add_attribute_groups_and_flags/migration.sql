-- Migration: add_attribute_groups_and_flags
-- Purely additive: no DROP, no RENAME, no data loss.
-- All new columns use DEFAULT values so existing rows are preserved.

-- ── AttributeGroup ────────────────────────────────────────────────────────────
CREATE TABLE `AttributeGroup` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(191) NOT NULL,
  `slug`        VARCHAR(191) NOT NULL,
  `description` VARCHAR(500) NULL,
  `icon`        VARCHAR(64)  NULL,
  `sortOrder`   INT          NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AttributeGroup_slug_key` (`slug`),
  INDEX `AttributeGroup_isActive_sortOrder_idx` (`isActive`, `sortOrder`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── AttributeGroupMember ──────────────────────────────────────────────────────
CREATE TABLE `AttributeGroupMember` (
  `groupId`     INT NOT NULL,
  `attributeId` INT NOT NULL,
  `sortOrder`   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`groupId`, `attributeId`),
  INDEX `AttributeGroupMember_attributeId_idx` (`attributeId`),
  CONSTRAINT `AttributeGroupMember_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `AttributeGroup` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AttributeGroupMember_attributeId_fkey`
    FOREIGN KEY (`attributeId`) REFERENCES `Attribute` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Attribute — new columns ───────────────────────────────────────────────────
ALTER TABLE `Attribute`
  ADD COLUMN `unit`          VARCHAR(32)  NULL          AFTER `type`,
  ADD COLUMN `description`   VARCHAR(500) NULL          AFTER `unit`,
  ADD COLUMN `showInDetail`  BOOLEAN      NOT NULL DEFAULT TRUE  AFTER `isActive`,
  ADD COLUMN `usedInFilter`  BOOLEAN      NOT NULL DEFAULT FALSE AFTER `showInDetail`,
  ADD COLUMN `usedInBuildPC` BOOLEAN      NOT NULL DEFAULT FALSE AFTER `usedInFilter`;

-- ── CategoryAttribute — new columns ──────────────────────────────────────────
ALTER TABLE `CategoryAttribute`
  ADD COLUMN `isRequired`         BOOLEAN NOT NULL DEFAULT FALSE AFTER `sortOrder`,
  ADD COLUMN `showInForm`         BOOLEAN NOT NULL DEFAULT TRUE  AFTER `isRequired`,
  ADD COLUMN `showInDetail`       BOOLEAN NOT NULL DEFAULT TRUE  AFTER `showInForm`,
  ADD COLUMN `usedInFilter`       BOOLEAN NOT NULL DEFAULT TRUE  AFTER `showInDetail`,
  ADD COLUMN `requiredForBuildPC` BOOLEAN NOT NULL DEFAULT FALSE AFTER `usedInFilter`;
