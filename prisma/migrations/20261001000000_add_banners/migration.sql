-- Additive migration: existing Product/User tables and data are unchanged.
CREATE TABLE `Banner` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `group` ENUM('MAIN', 'SIDE') NOT NULL,
    `position` ENUM('SIDE_LEFT', 'MAIN_TOP', 'MAIN_BOTTOM', 'SIDE_RIGHT_TOP', 'SIDE_RIGHT_MIDDLE', 'SIDE_RIGHT_BOTTOM') NOT NULL,
    `mediaType` ENUM('IMAGE', 'VIDEO') NOT NULL,
    `mediaUrl` VARCHAR(1000) NOT NULL,
    `mediaKey` VARCHAR(100) NOT NULL,
    `targetUrl` VARCHAR(1000) NULL,
    `altText` VARCHAR(300) NOT NULL DEFAULT '',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `autoplayInterval` INTEGER NOT NULL DEFAULT 4500,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `Banner_position_isActive_sortOrder_idx` (`position`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
