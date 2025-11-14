# MMS Pro - Auth Skeleton

Minimal multi-tenant auth scaffold for Machine Maintenance System.

## Stack
- Frontend: HTML/CSS/JS (no framework) in `public/`
- Backend: PHP API in `backend/api/` (vanilla PHP, JWT auth)
- DB: MySQL/MariaDB

## Setup
1. Create database:
   - Name: `mms_pro` (or set `DB_NAME` env for PHP)
2. Run migrations:
   - Import `backend/api/migrations.sql` in your MySQL server.
3. Configure API (optional env vars):
   - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `JWT_SECRET`, `JWT_ISS`
4. Serve API (dev):
   ```bash
   php -S localhost:8081 -t backend/api
   ```
   Or serve behind Apache/Nginx pointing to `backend/api/index.php` (see `.htaccess`).
5. Serve frontend (e.g., VSCode Live Server or simple PHP dev server):
   ```bash
   php -S localhost:8080 -t public
   ```
   Ensure `public/index.html` `API_BASE` points to your API URL (defaults to `../backend/api`).

## Seeding a Superadmin
After running migrations, create a superadmin user (global, no company):
```sql
INSERT INTO users (company_id, email, password_hash, full_name)
VALUES (NULL, 'admin@example.com', '$2y$10$REPLACE_WITH_PASSWORD_HASH', 'Super Admin');

INSERT INTO user_roles (user_id, role_id, company_id)
SELECT u.id, r.id, NULL
FROM users u, roles r
WHERE u.email='admin@example.com' AND r.name='superadmin' AND r.scope='global';
```
Generate a bcrypt password hash in PHP REPL:
```php
<?php echo password_hash('YourPassword123', PASSWORD_BCRYPT), "\n"; 
```

## API
Base: `/` (when served from `backend/api` root)

- POST `/auth/register_company`
  - body: `{ company, email, password, fullName? }`
  - creates a new company and first `company_admin`

- POST `/auth/login`
  - body: `{ email, password, company? }`
  - if `company` omitted, tries global user (e.g., `superadmin`)
  - returns `{ token, user }`

- GET `/auth/me`
  - headers: `Authorization: Bearer <token>`
  - returns token claims

- POST `/admin/users`
  - headers: `Authorization: Bearer <token>`
  - body: `{ email, password, fullName?, companyId?, role }`
  - superadmin can create users in any `companyId`; company_admin only in their company

## Notes
- Multi-tenant: `companies` table; users can be global (`company_id NULL`) or company-bound.
- Roles: `superadmin` (global), `company_admin`, `technician`, `viewer` (company scope).
- Permissions scaffolded in schema; enforcement can be added per endpoint as needed.

## Next Steps
- Add refresh tokens and logout.
- Add password reset.
- Enforce fine-grained permissions on future endpoints.
- Add company switching for users with roles in multiple companies.


