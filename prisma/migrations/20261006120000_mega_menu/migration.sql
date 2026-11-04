-- CreateTable
CREATE TABLE `MegaMenu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `categoryId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MegaMenu_categoryId_key`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MegaMenuGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `megaMenuId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `columnSpan` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MegaMenuGroup_megaMenuId_isActive_sortOrder_idx`(`megaMenuId`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MegaMenuItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `type` ENUM('CATEGORY', 'BRAND', 'PRICE_FILTER', 'ATTRIBUTE_FILTER', 'CUSTOM_URL') NOT NULL,
    `categoryId` INTEGER NULL,
    `brandId` INTEGER NULL,
    `attributeName` VARCHAR(100) NULL,
    `attributeValue` VARCHAR(500) NULL,
    `minPrice` INTEGER NULL,
    `maxPrice` INTEGER NULL,
    `customUrl` VARCHAR(1000) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MegaMenuItem_groupId_isActive_sortOrder_idx`(`groupId`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MegaMenuBrand` (
    `megaMenuId` INTEGER NOT NULL,
    `brandId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`megaMenuId`, `brandId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MegaMenu` ADD CONSTRAINT `MegaMenu_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuGroup` ADD CONSTRAINT `MegaMenuGroup_megaMenuId_fkey` FOREIGN KEY (`megaMenuId`) REFERENCES `MegaMenu`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuItem` ADD CONSTRAINT `MegaMenuItem_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `MegaMenuGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuItem` ADD CONSTRAINT `MegaMenuItem_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuItem` ADD CONSTRAINT `MegaMenuItem_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuBrand` ADD CONSTRAINT `MegaMenuBrand_megaMenuId_fkey` FOREIGN KEY (`megaMenuId`) REFERENCES `MegaMenu`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MegaMenuBrand` ADD CONSTRAINT `MegaMenuBrand_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
