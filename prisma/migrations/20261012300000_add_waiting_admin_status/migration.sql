-- Add WAITING_ADMIN status value to SupportTicket and change default
ALTER TABLE `SupportTicket`
  MODIFY COLUMN `status` ENUM('NEW','IN_PROGRESS','WAITING_ADMIN','WAITING_CUSTOMER','RESOLVED','CLOSED')
  NOT NULL DEFAULT 'WAITING_ADMIN';

-- Migrate existing NEW / IN_PROGRESS tickets to WAITING_ADMIN
UPDATE `SupportTicket` SET `status` = 'WAITING_ADMIN' WHERE `status` IN ('NEW', 'IN_PROGRESS');
