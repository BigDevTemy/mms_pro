-- Add machine and shutdown-related columns to work_orders
ALTER TABLE `work_orders`
  ADD COLUMN `machine_id` BIGINT UNSIGNED NULL AFTER `task_id`,
  ADD CONSTRAINT `fk_wo_machine` FOREIGN KEY (`machine_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL;

ALTER TABLE `work_orders`
  ADD COLUMN `was_shutdown` TINYINT(1) NOT NULL DEFAULT 0 AFTER `description`,
  ADD COLUMN `shutdown_start` DATETIME NULL AFTER `was_shutdown`,
  ADD COLUMN `shutdown_end` DATETIME NULL AFTER `shutdown_start`;

-- Helpful indexes
ALTER TABLE `work_orders`
  ADD KEY `idx_wo_machine` (`machine_id`),
  ADD KEY `idx_wo_shutdown_start` (`shutdown_start`),
  ADD KEY `idx_wo_shutdown_end` (`shutdown_end`);