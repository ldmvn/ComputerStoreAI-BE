-- Phase 2: RBAC, ActivityLog, BuildPC schema additions
-- All changes are ADDITIVE — no DROP, no data loss.

-- ── RBAC ─────────────────────────────────────────────────────────────────────

CREATE TABLE `Role` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(100) NOT NULL UNIQUE,
  `slug`        VARCHAR(100) NOT NULL UNIQUE,
  `description` VARCHAR(500) NULL,
  `isSystem`    BOOLEAN NOT NULL DEFAULT false,
  `isActive`    BOOLEAN NOT NULL DEFAULT true,
  `sortOrder`   INT NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  INDEX `Role_isActive_sortOrder_idx` (`isActive`, `sortOrder`)
);

CREATE TABLE `Permission` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `module`      VARCHAR(50) NOT NULL,
  `action`      VARCHAR(50) NOT NULL,
  `label`       VARCHAR(100) NOT NULL,
  `description` VARCHAR(200) NULL,
  UNIQUE KEY `Permission_module_action_key` (`module`, `action`),
  INDEX `Permission_module_idx` (`module`)
);

CREATE TABLE `RolePermission` (
  `roleId`       INT NOT NULL,
  `permissionId` INT NOT NULL,
  PRIMARY KEY (`roleId`, `permissionId`),
  CONSTRAINT `RolePermission_roleId_fkey`       FOREIGN KEY (`roleId`)       REFERENCES `Role`(`id`)       ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add adminRoleId + lastLoginAt to User (nullable, backward-compat)
ALTER TABLE `User`
  ADD COLUMN `adminRoleId` INT NULL,
  ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
  ADD INDEX `User_role_isActive_idx` (`role`, `isActive`),
  ADD INDEX `User_adminRoleId_idx` (`adminRoleId`),
  ADD CONSTRAINT `User_adminRoleId_fkey` FOREIGN KEY (`adminRoleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Activity Log ─────────────────────────────────────────────────────────────

CREATE TABLE `ActivityLog` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `userId`      INT NULL,
  `userEmail`   VARCHAR(191) NULL,
  `userName`    VARCHAR(191) NULL,
  `action`      VARCHAR(100) NOT NULL,
  `module`      VARCHAR(50) NOT NULL,
  `targetId`    VARCHAR(100) NULL,
  `targetLabel` VARCHAR(200) NULL,
  `description` VARCHAR(500) NULL,
  `success`     BOOLEAN NOT NULL DEFAULT true,
  `ipAddress`   VARCHAR(45) NULL,
  `userAgent`   VARCHAR(500) NULL,
  `before`      JSON NULL,
  `after`       JSON NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ActivityLog_userId_idx` (`userId`),
  INDEX `ActivityLog_module_action_idx` (`module`, `action`),
  INDEX `ActivityLog_createdAt_idx` (`createdAt`),
  INDEX `ActivityLog_success_idx` (`success`),
  CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

-- ── Build PC ──────────────────────────────────────────────────────────────────

CREATE TABLE `BuildPcGroup` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(100) NOT NULL,
  `slug`        VARCHAR(100) NOT NULL UNIQUE,
  `description` VARCHAR(300) NULL,
  `icon`        VARCHAR(100) NULL,
  `isRequired`  BOOLEAN NOT NULL DEFAULT true,
  `minCount`    INT NOT NULL DEFAULT 1,
  `maxCount`    INT NOT NULL DEFAULT 1,
  `sortOrder`   INT NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  INDEX `BuildPcGroup_sortOrder_isActive_idx` (`sortOrder`, `isActive`)
);

CREATE TABLE `BuildPcGroupCategory` (
  `groupId`    INT NOT NULL,
  `categoryId` INT NOT NULL,
  PRIMARY KEY (`groupId`, `categoryId`),
  INDEX `BuildPcGroupCategory_categoryId_idx` (`categoryId`),
  CONSTRAINT `BuildPcGroupCategory_groupId_fkey`    FOREIGN KEY (`groupId`)    REFERENCES `BuildPcGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BuildPcGroupCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`)     ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `CompatibilityRule` (
  `id`             INT AUTO_INCREMENT PRIMARY KEY,
  `name`           VARCHAR(200) NOT NULL,
  `description`    VARCHAR(500) NULL,
  `ruleType`       VARCHAR(50) NOT NULL,
  `groupAId`       INT NULL,
  `attributeASlug` VARCHAR(100) NULL,
  `groupBId`       INT NULL,
  `attributeBSlug` VARCHAR(100) NULL,
  `config`         JSON NULL,
  `errorMessage`   VARCHAR(300) NULL,
  `isActive`       BOOLEAN NOT NULL DEFAULT true,
  `sortOrder`      INT NOT NULL DEFAULT 0,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,
  INDEX `CompatibilityRule_ruleType_isActive_idx` (`ruleType`, `isActive`)
);

CREATE TABLE `BuildPcSettings` (
  `id`                 INT PRIMARY KEY DEFAULT 1,
  `manualBuildEnabled` BOOLEAN NOT NULL DEFAULT true,
  `aiBuildEnabled`     BOOLEAN NOT NULL DEFAULT false,
  `inStockOnly`        BOOLEAN NOT NULL DEFAULT true,
  `maxBudget`          INT NULL,
  `allowSubstitution`  BOOLEAN NOT NULL DEFAULT true,
  `updatedAt`          DATETIME(3) NOT NULL
);
