CREATE TABLE `Brand` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `logoUrl` VARCHAR(1000) NULL,
    `websiteUrl` VARCHAR(1000) NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Brand_slug_key`(`slug`),
    INDEX `Brand_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Product`
    MODIFY COLUMN `brand` VARCHAR(191) NULL,
    ADD COLUMN `brandId` INTEGER NULL,
    ADD INDEX `Product_brandId_idx`(`brandId`);

INSERT INTO `Brand` (`name`, `slug`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`)
SELECT MIN(TRIM(`brand`)), CONCAT('legacy-', MD5(LOWER(TRIM(`brand`)))), 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Product`
WHERE `brand` IS NOT NULL AND TRIM(`brand`) <> ''
GROUP BY CONCAT('legacy-', MD5(LOWER(TRIM(`brand`))));

UPDATE `Product` AS `product`
INNER JOIN `Brand` AS `brand`
    ON `brand`.`slug` = CONCAT('legacy-', MD5(LOWER(TRIM(`product`.`brand`))))
SET `product`.`brandId` = `brand`.`id`
WHERE `product`.`brand` IS NOT NULL AND TRIM(`product`.`brand`) <> '';

ALTER TABLE `Product`
    ADD CONSTRAINT `Product_brandId_fkey`
    FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;