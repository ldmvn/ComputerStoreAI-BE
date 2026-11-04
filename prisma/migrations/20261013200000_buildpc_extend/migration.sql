-- AlterTable: BuildPcGroup — add badgeText and exclusiveGroup
ALTER TABLE `BuildPcGroup`
    ADD COLUMN `badgeText` varchar(50) DEFAULT NULL,
    ADD COLUMN `exclusiveGroup` varchar(50) DEFAULT NULL;

-- AlterTable: ProductAttributeValue — add valueNumber for numeric comparison
ALTER TABLE `ProductAttributeValue`
    ADD COLUMN `valueNumber` decimal(12,4) DEFAULT NULL;

-- CreateTable: PcBuild
CREATE TABLE `PcBuild` (
    `id`        int NOT NULL AUTO_INCREMENT,
    `shareCode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
    `userId`    int DEFAULT NULL,
    `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `PcBuild_shareCode_key` (`shareCode`),
    KEY `PcBuild_userId_idx` (`userId`),
    CONSTRAINT `PcBuild_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable: PcBuildItem
CREATE TABLE `PcBuildItem` (
    `id`        int NOT NULL AUTO_INCREMENT,
    `buildId`   int NOT NULL,
    `groupId`   int NOT NULL,
    `productId` int NOT NULL,
    `quantity`  int NOT NULL DEFAULT '1',
    PRIMARY KEY (`id`),
    UNIQUE KEY `PcBuildItem_buildId_groupId_key` (`buildId`,`groupId`),
    KEY `PcBuildItem_groupId_idx` (`groupId`),
    KEY `PcBuildItem_productId_idx` (`productId`),
    CONSTRAINT `PcBuildItem_buildId_fkey`
        FOREIGN KEY (`buildId`) REFERENCES `PcBuild`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `PcBuildItem_groupId_fkey`
        FOREIGN KEY (`groupId`) REFERENCES `BuildPcGroup`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `PcBuildItem_productId_fkey`
        FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
