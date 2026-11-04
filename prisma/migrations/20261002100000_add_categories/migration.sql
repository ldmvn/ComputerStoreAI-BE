CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(64) NULL,
    `parentId` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Category_slug_key`(`slug`),
    INDEX `Category_parentId_sortOrder_idx`(`parentId`, `sortOrder`),
    INDEX `Category_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Product`
    ADD COLUMN `categoryId` INTEGER NULL,
    ADD INDEX `Product_categoryId_idx`(`categoryId`);

INSERT INTO `Category` (`name`, `slug`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`)
SELECT MIN(`category`), CONCAT('legacy-', MD5(LOWER(MIN(`category`)))), 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Product`
WHERE `category` IS NOT NULL AND TRIM(`category`) <> ''
GROUP BY LOWER(`category`);

UPDATE `Product` AS `product`
INNER JOIN `Category` AS `category`
    ON `category`.`slug` = CONCAT('legacy-', MD5(LOWER(`product`.`category`)))
SET `product`.`categoryId` = `category`.`id`
WHERE `product`.`category` IS NOT NULL AND TRIM(`product`.`category`) <> '';

ALTER TABLE `Category`
    ADD CONSTRAINT `Category_parentId_fkey`
    FOREIGN KEY (`parentId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Product`
    ADD CONSTRAINT `Product_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;