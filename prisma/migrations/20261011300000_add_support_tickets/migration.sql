-- CreateEnum
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (`id` VARCHAR(36) NOT NULL, `checksum` VARCHAR(64) NOT NULL, `finished_at` DATETIME(3) NULL, `migration_name` VARCHAR(255) NOT NULL, `logs` TEXT NULL, `rolled_back_at` DATETIME(3) NULL, `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `applied_steps_count` INTEGER UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SupportTicketStatus enum → stored as VARCHAR
-- SupportMessageSender enum → stored as VARCHAR
-- SupportNotification status → stored as VARCHAR

-- CreateTable SupportTicket
CREATE TABLE `SupportTicket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `guestName` VARCHAR(191) NOT NULL,
    `guestPhone` VARCHAR(30) NOT NULL,
    `guestEmail` VARCHAR(191) NULL,
    `category` VARCHAR(100) NOT NULL,
    `userId` INTEGER NULL,
    `assignedAdminId` INTEGER NULL,
    `status` ENUM('NEW','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED') NOT NULL DEFAULT 'NEW',
    `accessToken` CHAR(36) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `SupportTicket_code_key`(`code`),
    UNIQUE INDEX `SupportTicket_accessToken_key`(`accessToken`),
    INDEX `SupportTicket_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `SupportTicket_userId_idx`(`userId`),
    INDEX `SupportTicket_assignedAdminId_idx`(`assignedAdminId`),
    INDEX `SupportTicket_guestEmail_idx`(`guestEmail`),
    INDEX `SupportTicket_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable SupportMessage
CREATE TABLE `SupportMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `sender` ENUM('CUSTOMER','ADMIN','SYSTEM') NOT NULL,
    `senderName` VARCHAR(191) NULL,
    `adminId` INTEGER NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportMessage_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable SupportNotification
CREATE TABLE `SupportNotification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `messageId` INTEGER NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupportNotification_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SupportNotification_ticketId_idx`(`ticketId`),
    INDEX `SupportNotification_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey SupportTicket → User
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey SupportMessage → SupportTicket
ALTER TABLE `SupportMessage` ADD CONSTRAINT `SupportMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `SupportTicket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey SupportNotification → SupportTicket
ALTER TABLE `SupportNotification` ADD CONSTRAINT `SupportNotification_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `SupportTicket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
