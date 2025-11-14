-- Create machine_structures table for per-company dynamic hierarchy
CREATE TABLE IF NOT EXISTS `machine_structures` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `company_id` INT(11) NOT NULL,
  `structure_json` JSON NOT NULL,
  `version` INT(11) NOT NULL DEFAULT 1,
  `created_by` INT(11) DEFAULT NULL,
  `updated_by` INT(11) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_company` (`company_id`),
  KEY `idx_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- JSON structure expected in structure_json (example):
-- {
--   "nodeTypes": [
--     { "key": "line", "label": "Line", "attributes": [ { "key": "name", "type": "string", "required": true } ] },
--     { "key": "machine", "label": "Machine", "attributes": [ { "key": "name", "type": "string", "required": true } ] }
--   ],
--   "rules": [
--     { "parent": "line", "child": "machine" }
--   ],
--   "tree": {
--     "id": "root",
--     "type": "root",
--     "children": []
--   }
-- }

-- Note: Do not set a DEFAULT value for JSON to preserve compatibility across MySQL versions.