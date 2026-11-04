-- CreateTable
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `method` ENUM('COD', 'BANK_TRANSFER', 'MOMO', 'VNPAY') NOT NULL,
    `status` ENUM('PENDING', 'AWAITING_VERIFICATION', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'VND',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_orderId_key`(`orderId`),
    INDEX `Payment_status_idx`(`status`),
    INDEX `Payment_method_idx`(`method`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentAttempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentId` INTEGER NOT NULL,
    `method` ENUM('COD', 'BANK_TRANSFER', 'MOMO', 'VNPAY') NOT NULL,
    `merchantReference` VARCHAR(100) NOT NULL,
    `providerTransactionId` VARCHAR(100) NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'VND',
    `status` ENUM('PENDING', 'AWAITING_VERIFICATION', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `bankBin` VARCHAR(20) NULL,
    `bankName` VARCHAR(100) NULL,
    `bankAccountNumber` VARCHAR(50) NULL,
    `bankAccountName` VARCHAR(191) NULL,
    `transferContent` VARCHAR(255) NULL,
    `requestPayload` JSON NULL,
    `responsePayload` JSON NULL,
    `errorMessage` VARCHAR(500) NULL,
    `reportedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentAttempt_merchantReference_key`(`merchantReference`),
    UNIQUE INDEX `PaymentAttempt_method_providerTxId_key`(`method`, `providerTransactionId`),
    INDEX `PaymentAttempt_paymentId_idx`(`paymentId`),
    INDEX `PaymentAttempt_status_idx`(`status`),
    INDEX `PaymentAttempt_providerTransactionId_idx`(`providerTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentAttempt` ADD CONSTRAINT `PaymentAttempt_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
