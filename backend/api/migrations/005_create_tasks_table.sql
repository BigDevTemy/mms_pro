-- Create tasks table for maintenance scheduling
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(255) NOT NULL,
  `category` ENUM('Electrical','Mechanical') NOT NULL,
  `frequency` ENUM('daily','weekly','monthly','yearly') NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
  `priority` ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `due_date` DATE NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_tasks_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL,
  KEY `idx_tasks_company` (`company_id`),
  KEY `idx_tasks_status` (`status`),
  KEY `idx_tasks_category` (`category`),
  KEY `idx_tasks_frequency` (`frequency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: Tasks are scoped to company where applicable; superadmin may see all.