-- Machine Maintenance System - Initial Schema
-- MySQL-compatible SQL

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_company_name (name)
);

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  scope ENUM('global','company') NOT NULL DEFAULT 'company',
  UNIQUE KEY uniq_role_name_scope (name, scope)
);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(255) NULL,
  UNIQUE KEY uniq_permission_name (name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_user_email_company (email, company_id)
);

-- Users can have multiple roles. Superadmins will be global scoped (company_id NULL)
CREATE TABLE IF NOT EXISTS user_roles (
   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
   user_id BIGINT UNSIGNED NOT NULL,
   role_id BIGINT UNSIGNED NOT NULL,
   company_id BIGINT UNSIGNED NULL,
   UNIQUE KEY uniq_user_role_company (user_id, role_id, company_id),
   CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
   CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
   CONSTRAINT fk_ur_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Seed base roles
INSERT INTO roles (name, description, scope) VALUES
  ('superadmin', 'Global super administrator', 'global')
ON DUPLICATE KEY UPDATE name = name;

INSERT INTO roles (name, description, scope) VALUES
  ('company_admin', 'Admin within a company', 'company'),
  ('technician', 'Performs maintenance tasks', 'company'),
  ('viewer', 'Read-only access within a company', 'company')
ON DUPLICATE KEY UPDATE name = name;

-- Example permissions (extend later)
INSERT INTO permissions (name, description) VALUES
  ('company.manage', 'Create and manage companies'),
  ('user.manage', 'Manage users within a company'),
  ('asset.view', 'View assets'),
  ('asset.edit', 'Create and update assets')
ON DUPLICATE KEY UPDATE name = name;

-- Map permissions to roles (basic defaults)
-- superadmin gets everything via app logic; but we grant a few explicitly
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'superadmin' AND r.scope='global';

-- company_admin gets user.manage, asset.view, asset.edit
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('user.manage','asset.view','asset.edit')
WHERE r.name='company_admin' AND r.scope='company';

-- technician gets asset.view, asset.edit
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('asset.view','asset.edit')
WHERE r.name='technician' AND r.scope='company';

-- viewer gets asset.view
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('asset.view')
WHERE r.name='viewer' AND r.scope='company';

-- Helper procedure to seed a superadmin user (run manually with your email/password hash)
-- Example:
-- INSERT INTO users (company_id, email, password_hash, full_name) VALUES (NULL, 'admin@example.com', '$2y$10$hash...', 'Super Admin');
-- INSERT INTO user_roles (user_id, role_id, company_id)
--   SELECT u.id, r.id, NULL FROM users u, roles r WHERE u.email='admin@example.com' AND r.name='superadmin' AND r.scope='global';

-- Assets table for CRUD
CREATE TABLE IF NOT EXISTS assets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assets_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  KEY idx_assets_company (company_id)
);

-- Refresh tokens for JWT session continuity
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_refresh_token (token),
  KEY idx_refresh_user (user_id)
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_reset_token (token),
  KEY idx_reset_user (user_id)
);


