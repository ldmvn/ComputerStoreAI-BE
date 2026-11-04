-- Remove duplicate reviews: keep the highest-id review per (userId, productId)
DELETE FROM `ProductReview`
WHERE `userId` IS NOT NULL
  AND `id` NOT IN (
    SELECT max_id FROM (
      SELECT MAX(id) AS max_id
      FROM `ProductReview`
      WHERE `userId` IS NOT NULL
      GROUP BY `userId`, `productId`
    ) AS keep
  );

-- Add verifiedPurchase column
ALTER TABLE `ProductReview`
  ADD COLUMN `verifiedPurchase` TINYINT(1) NOT NULL DEFAULT 0;

-- Back-fill verifiedPurchase for existing reviews that have a DELIVERED order
UPDATE `ProductReview` r
SET r.`verifiedPurchase` = 1
WHERE r.`userId` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `OrderItem` oi
    INNER JOIN `Order` o ON o.`id` = oi.`orderId`
    WHERE oi.`productId` = r.`productId`
      AND o.`userId`    = r.`userId`
      AND o.`status`    = 'DELIVERED'
  );

-- Add unique constraint (MySQL allows multiple NULLs, so nullable userId rows are fine)
ALTER TABLE `ProductReview`
  ADD CONSTRAINT `ProductReview_userId_productId_key`
  UNIQUE (`userId`, `productId`);
