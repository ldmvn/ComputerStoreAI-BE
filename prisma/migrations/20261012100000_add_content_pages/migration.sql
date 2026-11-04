-- CreateTable: PolicyPage (footer content editor, Phase 1: warranty)
-- NOTE: ContentPage table already exists from old removed CMS — left untouched.
CREATE TABLE IF NOT EXISTS `PolicyPage` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `pageKey` VARCHAR(100) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` VARCHAR(500) NULL,
  `contentHtml` MEDIUMTEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `updatedByAdminId` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PolicyPage_pageKey_key` (`pageKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
