-- AlterTable
ALTER TABLE `category` ADD COLUMN `skuPrefix` VARCHAR(8) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Category_skuPrefix_key` ON `Category`(`skuPrefix`);
