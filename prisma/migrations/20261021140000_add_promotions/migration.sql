-- CreateTable
CREATE TABLE `Promotion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `displayTitle` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `conditionText` TEXT NULL,
    `detailUrl` VARCHAR(1000) NULL,
    `type` ENUM('GIFT', 'INFO') NOT NULL,
    `scope` ENUM('ALL', 'CATEGORY', 'PRODUCT') NOT NULL DEFAULT 'ALL',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `giftProductId` INTEGER NULL,
    `giftProductName` VARCHAR(191) NULL,
    `giftQuantity` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Promotion_isActive_startAt_endAt_idx`(`isActive`, `startAt`, `endAt`),
    INDEX `Promotion_scope_idx`(`scope`),
    INDEX `Promotion_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,

    INDEX `PromotionCategory_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `PromotionCategory_promotionId_categoryId_key`(`promotionId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionProduct` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,

    INDEX `PromotionProduct_productId_idx`(`productId`),
    UNIQUE INDEX `PromotionProduct_promotionId_productId_key`(`promotionId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Promotion` ADD CONSTRAINT `Promotion_giftProductId_fkey` FOREIGN KEY (`giftProductId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCategory` ADD CONSTRAINT `PromotionCategory_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCategory` ADD CONSTRAINT `PromotionCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionProduct` ADD CONSTRAINT `PromotionProduct_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionProduct` ADD CONSTRAINT `PromotionProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
