-- CreateTable
CREATE TABLE `BuildPcPreset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,
    `useCase` VARCHAR(100) NULL,
    `budgetMin` INTEGER NULL,
    `budgetMax` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BuildPcPreset_slug_key`(`slug`),
    INDEX `BuildPcPreset_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BuildPcPresetItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `presetId` INTEGER NOT NULL,
    `groupId` INTEGER NOT NULL,
    `productId` INTEGER NULL,

    INDEX `BuildPcPresetItem_groupId_idx`(`groupId`),
    INDEX `BuildPcPresetItem_productId_idx`(`productId`),
    UNIQUE INDEX `BuildPcPresetItem_presetId_groupId_key`(`presetId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BuildPcPresetItem` ADD CONSTRAINT `BuildPcPresetItem_presetId_fkey` FOREIGN KEY (`presetId`) REFERENCES `BuildPcPreset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BuildPcPresetItem` ADD CONSTRAINT `BuildPcPresetItem_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `BuildPcGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BuildPcPresetItem` ADD CONSTRAINT `BuildPcPresetItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
