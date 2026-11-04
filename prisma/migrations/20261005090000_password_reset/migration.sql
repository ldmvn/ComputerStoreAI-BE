CREATE TABLE `PasswordReset` (
  `email` VARCHAR(191) NOT NULL,
  `challengeId` CHAR(64) NOT NULL,
  `otpHash` CHAR(64) NULL,
  `tokenHash` CHAR(64) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `tokenExpiresAt` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `sentAt` DATETIME(3) NOT NULL,
  `windowStart` DATETIME(3) NOT NULL,
  `requestCount` INTEGER NOT NULL DEFAULT 1,
  UNIQUE INDEX `PasswordReset_challengeId_key` (`challengeId`),
  UNIQUE INDEX `PasswordReset_tokenHash_key` (`tokenHash`),
  INDEX `PasswordReset_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
