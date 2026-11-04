CREATE TABLE `ProductSection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `viewAllUrl` VARCHAR(1000) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductSection_slug_key`(`slug`),
    INDEX `ProductSection_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductSectionItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sectionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `ProductSectionItem_sectionId_productId_key`(`sectionId`, `productId`),
    INDEX `ProductSectionItem_sectionId_sortOrder_idx`(`sectionId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductSectionItem`
    ADD CONSTRAINT `ProductSectionItem_sectionId_fkey`
    FOREIGN KEY (`sectionId`) REFERENCES `ProductSection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductSectionItem`
    ADD CONSTRAINT `ProductSectionItem_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;