-- Create work_orders table to capture execution details of tasks
CREATE TABLE IF NOT EXISTS `work_orders` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` BIGINT UNSIGNED NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('open','assigned','in_progress','on_hold','completed','cancelled') NOT NULL DEFAULT 'open',
  `priority` ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `assigned_to` BIGINT UNSIGNED NULL,               -- user id (optional)
  `due_date` DATE NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_wo_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wo_task` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  KEY `idx_wo_company` (`company_id`),
  KEY `idx_wo_task` (`task_id`),
  KEY `idx_wo_status` (`status`),
  KEY `idx_wo_priority` (`priority`),
  KEY `idx_wo_assigned_to` (`assigned_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;