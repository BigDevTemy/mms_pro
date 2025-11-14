<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';

class AuthController
{
    public static function login(): void
    {
        global $env;
        $input = json_input();
        $email = trim($input['email'] ?? '');
        $password = (string)($input['password'] ?? '');
        $companyName = isset($input['company']) ? trim((string)$input['company']) : null; // optional for superadmin

        if ($email === '' || $password === '') {
            json_response(['error' => 'Email and password are required'], 400);
        }

        $pdo = db();

        $companyId = null;
        if ($companyName !== null && $companyName !== '') {
            // Company name explicitly provided (legacy flow)
            $stmt = $pdo->prepare('SELECT id FROM companies WHERE name = ?');
            $stmt->execute([$companyName]);
            $row = $stmt->fetch();
            if (!$row) {
                json_response(['error' => 'Company not found'], 404);
            }
            $companyId = (int)$row['id'];
        }
        
        // When company is not provided, allow login by email only:
        // Prefer a global (superadmin) account if present (company_id IS NULL),
        // otherwise fall back to the company-scoped user with the same email.
        if ($companyName === null || $companyName === '') {
            $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? ORDER BY company_id IS NULL DESC LIMIT 1');
            $stmt->execute([$email]);
        } else {
            $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? AND (company_id = ? OR company_id IS NULL) ORDER BY company_id IS NULL DESC LIMIT 1');
            $stmt->execute([$email, $companyId]);
        }
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            json_response(['error' => 'Invalid credentials'], 401);
        }
        if ((int)$user['is_active'] !== 1) {
            json_response(['error' => 'Account disabled'], 403);
        }

        // Fetch roles for token context
        $rolesStmt = $pdo->prepare('SELECT r.name, r.scope, ur.company_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?');
        $rolesStmt->execute([$user['id']]);
        $roles = $rolesStmt->fetchAll();

        $payload = [
            'sub' => (int)$user['id'],
            'email' => $user['email'],
            'company_id' => $user['company_id'] !== null ? (int)$user['company_id'] : null,
            'roles' => array_map(function ($r) { return ['name' => $r['name'], 'scope' => $r['scope'], 'company_id' => $r['company_id'] !== null ? (int)$r['company_id'] : null]; }, $roles),
        ];
        $token = Jwt::sign($payload, $env['JWT_SECRET'], $env['JWT_ISS']);

        // Create refresh token (rotate on login)
        $refresh = bin2hex(random_bytes(32));
        $expires = (new DateTimeImmutable('+30 days'))->format('Y-m-d H:i:s');
        $pdo->prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
            ->execute([(int)$user['id'], $refresh, $expires]);

        json_response(['token' => $token, 'refreshToken' => $refresh, 'user' => $payload]);
    }

    public static function registerCompany(): void
    {
        // Public endpoint to create a company and its first admin user
        $input = json_input();
        $companyName = trim($input['company'] ?? '');
        $adminEmail = trim($input['email'] ?? '');
        $adminPassword = (string)($input['password'] ?? '');
        $fullName = trim($input['fullName'] ?? '');
        if ($companyName === '' || $adminEmail === '' || $adminPassword === '') {
            json_response(['error' => 'company, email and password are required'], 400);
        }
        $pdo = db();
        try {
            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO companies (name) VALUES (?)')->execute([$companyName]);
            $companyId = (int)$pdo->lastInsertId();

            $passwordHash = password_hash($adminPassword, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare('INSERT INTO users (company_id, email, password_hash, full_name) VALUES (?, ?, ?, ?)');
            $stmt->execute([$companyId, $adminEmail, $passwordHash, $fullName]);
            $userId = (int)$pdo->lastInsertId();

            // Assign company_admin role
            $roleStmt = $pdo->prepare("SELECT id FROM roles WHERE name='company_admin' AND scope='company' LIMIT 1");
            $roleStmt->execute();
            $role = $roleStmt->fetch();
            if ($role) {
                $pdo->prepare('INSERT INTO user_roles (user_id, role_id, company_id) VALUES (?, ?, ?)')->execute([$userId, (int)$role['id'], $companyId]);
            }

            $pdo->commit();
            json_response(['message' => 'Company registered', 'companyId' => $companyId]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Company or email already exists'], 409);
            }
            json_response(['error' => 'Failed to register company'], 500);
        }
    }

    public static function me(): void
    {
        global $env;
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.*)$/i', $auth, $m)) {
            json_response(['error' => 'Unauthorized'], 401);
        }
        $token = $m[1];
        try {
            $payload = Jwt::verify($token, $env['JWT_SECRET'], $env['JWT_ISS']);
            json_response(['user' => $payload]);
        } catch (Throwable $e) {
            json_response(['error' => 'Unauthorized'], 401);
        }
    }

    public static function refresh(): void
    {
        global $env;
        $input = json_input();
        $refresh = isset($input['refreshToken']) ? (string)$input['refreshToken'] : '';
        if ($refresh === '') { json_response(['error' => 'refreshToken required'], 400); }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT rt.user_id, rt.expires_at, rt.revoked, u.email, u.company_id FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token = ? LIMIT 1');
        $stmt->execute([$refresh]);
        $row = $stmt->fetch();
        if (!$row) { json_response(['error' => 'Invalid refresh token'], 401); }
        if ((int)$row['revoked'] === 1 || new DateTimeImmutable() >= new DateTimeImmutable($row['expires_at'])) {
            json_response(['error' => 'Refresh token expired or revoked'], 401);
        }
        // Build roles
        $rolesStmt = $pdo->prepare('SELECT r.name, r.scope, ur.company_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?');
        $rolesStmt->execute([(int)$row['user_id']]);
        $roles = $rolesStmt->fetchAll();
        $payload = [
            'sub' => (int)$row['user_id'],
            'email' => $row['email'],
            'company_id' => $row['company_id'] !== null ? (int)$row['company_id'] : null,
            'roles' => array_map(function ($r) { return ['name' => $r['name'], 'scope' => $r['scope'], 'company_id' => $r['company_id'] !== null ? (int)$r['company_id'] : null]; }, $roles),
        ];
        $token = Jwt::sign($payload, $env['JWT_SECRET'], $env['JWT_ISS']);
        // Optional rotation: issue new refresh and revoke old
        $newRefresh = bin2hex(random_bytes(32));
        $expires = (new DateTimeImmutable('+30 days'))->format('Y-m-d H:i:s');
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?')->execute([$refresh]);
        $pdo->prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')->execute([(int)$row['user_id'], $newRefresh, $expires]);
        $pdo->commit();
        json_response(['token' => $token, 'refreshToken' => $newRefresh, 'user' => $payload]);
    }

    public static function logout(): void
    {
        $input = json_input();
        $refresh = isset($input['refreshToken']) ? (string)$input['refreshToken'] : '';
        if ($refresh === '') { json_response(['error' => 'refreshToken required'], 400); }
        $pdo = db();
        $pdo->prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?')->execute([$refresh]);
        json_response(['message' => 'Logged out']);
    }

    public static function requestPasswordReset(): void
    {
        $input = json_input();
        $email = trim($input['email'] ?? '');
        if ($email === '') { json_response(['error' => 'email required'], 400); }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user) { json_response(['message' => 'If the email exists, a link was sent']); }
        $token = bin2hex(random_bytes(32));
        $expires = (new DateTimeImmutable('+1 hour'))->format('Y-m-d H:i:s');
        $pdo->prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)')->execute([(int)$user['id'], $token, $expires]);
        // In production: send email with token link. For dev, return token.
        json_response(['message' => 'Reset created', 'resetToken' => $token]);
    }

    public static function resetPassword(): void
    {
        $input = json_input();
        $token = isset($input['resetToken']) ? (string)$input['resetToken'] : '';
        $newPassword = (string)($input['newPassword'] ?? '');
        if ($token === '' || $newPassword === '') { json_response(['error' => 'resetToken and newPassword required'], 400); }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ? LIMIT 1');
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) { json_response(['error' => 'Invalid token'], 400); }
        if ((int)$row['used'] === 1 || new DateTimeImmutable() >= new DateTimeImmutable($row['expires_at'])) {
            json_response(['error' => 'Token expired or used'], 400);
        }
        $hash = password_hash($newPassword, PASSWORD_BCRYPT);
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, (int)$row['user_id']]);
        $pdo->prepare('UPDATE password_resets SET used = 1 WHERE id = ?')->execute([(int)$row['id']]);
        // revoke all refresh tokens for this user
        $pdo->prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?')->execute([(int)$row['user_id']]);
        $pdo->commit();
        json_response(['message' => 'Password reset successful']);
    }

    // One-time setup: create first superadmin if none exists
    public static function registerSuperadmin(): void
    {
        $input = json_input();
        $email = trim($input['email'] ?? '');
        $password = (string)($input['password'] ?? '');
        $fullName = trim($input['fullName'] ?? '');
        if ($email === '' || $password === '') {
            json_response(['error' => 'email and password are required'], 400);
        }
        $pdo = db();
        // Check if any superadmin exists
        $check = $pdo->query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name='superadmin' AND r.scope='global' LIMIT 1");
        if ($check->fetchColumn()) {
            json_response(['error' => 'Superadmin already exists'], 409);
        }
        try {
            $pdo->beginTransaction();
            $passwordHash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare('INSERT INTO users (company_id, email, password_hash, full_name) VALUES (NULL, ?, ?, ?)');
            $stmt->execute([$email, $passwordHash, $fullName]);
            $userId = (int)$pdo->lastInsertId();
            $roleStmt = $pdo->prepare("SELECT id FROM roles WHERE name='superadmin' AND scope='global' LIMIT 1");
            $roleStmt->execute();
            $role = $roleStmt->fetch();
            if (!$role) { throw new Exception('superadmin role missing'); }
            $pdo->prepare('INSERT INTO user_roles (user_id, role_id, company_id) VALUES (?, ?, NULL)')->execute([$userId, (int)$role['id']]);
            $pdo->commit();
            json_response(['message' => 'Superadmin created']);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Email already exists'], 409);
            }
            json_response(['error' => 'Failed to create superadmin'], 500);
        }
    }
}


