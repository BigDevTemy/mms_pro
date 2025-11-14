-- Metadata for per-company physical schema management (Option A)

-- Tracks each Apply Schema execution per company
CREATE TABLE IF NOT EXISTS `company_schema_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `company_id` INT NOT NULL,
  `version` INT NOT NULL,
  `breaking` TINYINT(1) NOT NULL DEFAULT 0,
  `summary_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_csv_company` (`company_id`),
  UNIQUE KEY `uniq_csv_company_version` (`company_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registry of generated physical tables per company (helps auditing & cleanup)
CREATE TABLE IF NOT EXISTS `company_table_registry` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `company_id` INT NOT NULL,
  `type_key` VARCHAR(128) NOT NULL,         -- e.g., 'line', 'machine', 'subline', 'project'
  `table_name` VARCHAR(255) NOT NULL,       -- e.g., 'c3_line'
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ctr_company_type` (`company_id`, `type_key`),
  KEY `idx_ctr_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;