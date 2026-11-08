-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `costPrice` INTEGER NULL;

-- Backfill historical lines with the product's current cost (best available estimate)
UPDATE `OrderItem` oi
JOIN `Product` p ON p.id = oi.productId
SET oi.costPrice = p.costPrice
WHERE oi.costPrice IS NULL AND p.costPrice IS NOT NULL AND p.costPrice > 0;
