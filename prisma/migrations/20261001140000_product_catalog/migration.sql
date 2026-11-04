ALTER TABLE `Product`
    ADD COLUMN `slug` VARCHAR(191) NULL,
    ADD COLUMN `sku` VARCHAR(100) NULL,
    ADD COLUMN `category` VARCHAR(100) NULL,
    ADD COLUMN `brand` VARCHAR(100) NULL,
    ADD COLUMN `shortDescription` VARCHAR(500) NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `originalPrice` INTEGER NULL,
    ADD COLUMN `costPrice` INTEGER NULL,
    ADD COLUMN `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lowStockThreshold` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `Product` SET
    `slug` = CONCAT('product-', `id`),
    `sku` = CONCAT('LEGACY-', `id`)
WHERE `slug` IS NULL OR `sku` IS NULL;

ALTER TABLE `Product`
    MODIFY `slug` VARCHAR(191) NOT NULL,
    MODIFY `sku` VARCHAR(100) NOT NULL,
    ADD UNIQUE INDEX `Product_slug_key`(`slug`),
    ADD UNIQUE INDEX `Product_sku_key`(`sku`),
    ADD INDEX `Product_isActive_isDeleted_stockQuantity_idx`(`isActive`, `isDeleted`, `stockQuantity`),
    ADD INDEX `Product_category_idx`(`category`),
    ADD INDEX `Product_updatedAt_idx`(`updatedAt`);

CREATE TABLE `ProductImage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `imageUrl` VARCHAR(1000) NOT NULL,
    `altText` VARCHAR(300) NOT NULL DEFAULT '',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ProductImage_productId_sortOrder_idx`(`productId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductSpecification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `value` VARCHAR(500) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ProductSpecification_productId_sortOrder_idx`(`productId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductImage`
    ADD CONSTRAINT `ProductImage_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductSpecification`
    ADD CONSTRAINT `ProductSpecification_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
