ALTER TABLE `ProductReview` ADD COLUMN `images` TEXT NULL;
ALTER TABLE `ProductReview` ADD COLUMN `userId` INTEGER NULL;
ALTER TABLE `ProductReview` ADD INDEX `ProductReview_userId_idx` (`userId`);
ALTER TABLE `ProductReview` ADD CONSTRAINT `ProductReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
