CREATE TABLE `Attribute` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `type` ENUM('SELECT', 'MULTI_SELECT', 'TEXT', 'NUMBER', 'BOOLEAN') NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Attribute_slug_key` (`slug`),
  INDEX `Attribute_isActive_sortOrder_idx` (`isActive`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttributeValue` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `attributeId` INTEGER NOT NULL,
  `value` VARCHAR(500) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AttributeValue_attributeId_value_key` (`attributeId`, `value`),
  INDEX `AttributeValue_attributeId_isActive_sortOrder_idx` (`attributeId`, `isActive`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CategoryAttribute` (
  `categoryId` INTEGER NOT NULL,
  `attributeId` INTEGER NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  INDEX `CategoryAttribute_attributeId_idx` (`attributeId`),
  PRIMARY KEY (`categoryId`, `attributeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductAttributeValue` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `productId` INTEGER NOT NULL,
  `attributeId` INTEGER NOT NULL,
  `attributeValueId` INTEGER NULL,
  `valueText` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ProductAttributeValue_productId_attributeId_attributeValueId_key` (`productId`, `attributeId`, `attributeValueId`),
  INDEX `ProductAttributeValue_attributeId_attributeValueId_idx` (`attributeId`, `attributeValueId`),
  INDEX `ProductAttributeValue_productId_attributeId_idx` (`productId`, `attributeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MegaMenuItem` ADD COLUMN `attributeId` INTEGER NULL, ADD COLUMN `attributeValueId` INTEGER NULL;
CREATE INDEX `MegaMenuItem_attributeId_idx` ON `MegaMenuItem`(`attributeId`);
CREATE INDEX `MegaMenuItem_attributeValueId_idx` ON `MegaMenuItem`(`attributeValueId`);

ALTER TABLE `AttributeValue` ADD CONSTRAINT `AttributeValue_attributeId_fkey` FOREIGN KEY (`attributeId`) REFERENCES `Attribute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CategoryAttribute` ADD CONSTRAINT `CategoryAttribute_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CategoryAttribute` ADD CONSTRAINT `CategoryAttribute_attributeId_fkey` FOREIGN KEY (`attributeId`) REFERENCES `Attribute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductAttributeValue` ADD CONSTRAINT `ProductAttributeValue_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductAttributeValue` ADD CONSTRAINT `ProductAttributeValue_attributeId_fkey` FOREIGN KEY (`attributeId`) REFERENCES `Attribute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductAttributeValue` ADD CONSTRAINT `ProductAttributeValue_attributeValueId_fkey` FOREIGN KEY (`attributeValueId`) REFERENCES `AttributeValue`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MegaMenuItem` ADD CONSTRAINT `MegaMenuItem_attributeId_fkey` FOREIGN KEY (`attributeId`) REFERENCES `Attribute`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MegaMenuItem` ADD CONSTRAINT `MegaMenuItem_attributeValueId_fkey` FOREIGN KEY (`attributeValueId`) REFERENCES `AttributeValue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
