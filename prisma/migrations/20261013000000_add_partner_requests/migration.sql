-- CreateEnum
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (SELECT * FROM `_prisma_migrations` WHERE 1=0);

-- CreateTable
CREATE TABLE `PartnerRequest` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `code`      VARCHAR(30) NOT NULL,
  `company`   VARCHAR(191) NOT NULL,
  `contact`   VARCHAR(191) NOT NULL,
  `phone`     VARCHAR(30) NOT NULL,
  `email`     VARCHAR(191) NOT NULL,
  `type`      VARCHAR(100) NOT NULL,
  `message`   TEXT NOT NULL,
  `status`    ENUM('NEW','PROCESSING','REPLIED','COMPLETED','REJECTED') NOT NULL DEFAULT 'NEW',
  `note`      TEXT NULL,
  `ipAddress` VARCHAR(45) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PartnerRequest_code_key`(`code`),
  INDEX `PartnerRequest_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `PartnerRequest_email_idx`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
