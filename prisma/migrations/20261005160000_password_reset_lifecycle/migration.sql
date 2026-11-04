ALTER TABLE `PasswordReset`
  ADD COLUMN `verifiedAt` DATETIME(3) NULL,
  ADD COLUMN `usedAt` DATETIME(3) NULL;

-- Preserve existing verified sessions and mark already invalidated codes as used.
UPDATE `PasswordReset` SET `verifiedAt` = `sentAt` WHERE `tokenHash` IS NOT NULL;
UPDATE `PasswordReset` SET `usedAt` = `sentAt` WHERE `otpHash` IS NULL AND `tokenHash` IS NULL;
