ALTER TABLE `User`
  MODIFY `phone` VARCHAR(191) NULL,
  ADD COLUMN `googleId` VARCHAR(191) NULL,
  ADD COLUMN `avatarUrl` VARCHAR(1000) NULL,
  ADD UNIQUE INDEX `User_googleId_key` (`googleId`);

CREATE TABLE `GoogleLoginExchange` (
  `codeHash` CHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL,
  `challenge` VARCHAR(43) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `GoogleLoginExchange_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`codeHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
