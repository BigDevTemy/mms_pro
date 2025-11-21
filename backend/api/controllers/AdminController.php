<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class AdminController
{
    private static function requireAuth(): array
    {
        global $env;

        // Try to obtain token from multiple sources to be robust behind proxies/CGI
        $token = null;

        // 1) Authorization: Bearer <token>
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            $token = $m[1];
        }

        // 2) X-Auth-Token header (set by some frontends)
        if ($token === null && isset($_SERVER['HTTP_X_AUTH_TOKEN']) && $_SERVER['HTTP_X_AUTH_TOKEN'] !== '') {
            $token = $_SERVER['HTTP_X_AUTH_TOKEN'];
        }

        // 3) token as query param (our frontend may append ?token=...)
        if ($token === null && isset($_GET['token']) && $_GET['token'] !== '') {
            $token = (string)$_GET['token'];
        }

        // 4) token in JSON body (fallback for POST/PUT/DELETE where headers may be stripped)
        if ($token === null) {
            $input = json_input();
            if (isset($input['token']) && $input['token'] !== '') {
                $token = (string)$input['token'];
            }
        }

        if ($token === null) {
            json_response(['error' => 'Unauthorized'], 401);
        }

        try {
            return Jwt::verify($token, $env['JWT_SECRET'], $env['JWT_ISS']);
        } catch (Throwable $e) {
            json_response(['error' => 'Unauthorized'], 401);
        }
    }

    private static function isSuperadmin(array $claims): bool
    {
        foreach (($claims['roles'] ?? []) as $r) {
            if (($r['name'] ?? '') === 'superadmin' && ($r['scope'] ?? '') === 'global') {
                return true;
            }
        }
        return false;
    }

    public static function createUser(): void
    {
        $claims = self::requireAuth();
        $input = json_input();

        $email = trim($input['email'] ?? '');
        $password = (string)($input['password'] ?? '');
        $firstName = trim($input['firstName'] ?? '');
        $lastName = trim($input['lastName'] ?? '');
        $employeeNumber = trim($input['employeeNumber'] ?? '');
        $fullName = trim($input['fullName'] ?? (($firstName !== '' || $lastName !== '') ? trim($firstName . ' ' . $lastName) : ''));
        $companyId = isset($input['companyId']) ? (int)$input['companyId'] : null;
        $roleName = trim($input['role'] ?? ''); // e.g., company_admin/technician/viewer

        if ($email === '' || $password === '' || $roleName === '') {
            json_response(['error' => 'email, password, role are required'], 400);
        }

        $pdo = db();

        // Authorization
        $allowedCompanyId = null;
        if (self::isSuperadmin($claims)) {
            $allowedCompanyId = $companyId; // superadmin must specify company for company roles; null for global users (rare)
        } else {
            $allowedCompanyId = $claims['company_id'] ?? null;
            if ($companyId !== null && $companyId !== $allowedCompanyId) {
                json_response(['error' => 'Forbidden'], 403);
            }
            // Company admins need user.manage in their company
            if (!Permissions::userHasPermission($claims, 'user.manage', $allowedCompanyId)) {
                json_response(['error' => 'Insufficient permissions'], 403);
            }
        }

        try {
            $pdo->beginTransaction();
            $passwordHash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare('INSERT INTO users (company_id, email, password_hash, full_name,employee_number) VALUES (?, ?, ?, ?,?)');
            $stmt->execute([$allowedCompanyId, $email, $passwordHash, $fullName,$employeeNumber]);
            $userId = (int)$pdo->lastInsertId();

            $scope = $roleName === 'superadmin' ? 'global' : 'company';
            $roleStmt = $pdo->prepare('SELECT id, scope FROM roles WHERE name = ? AND scope = ? LIMIT 1');
            $roleStmt->execute([$roleName, $scope]);
            $role = $roleStmt->fetch();
            if (!$role) {
                throw new Exception('Role not found');
            }

            $pdo->prepare('INSERT INTO user_roles (user_id, role_id, company_id) VALUES (?, ?, ?)')
                ->execute([$userId, (int)$role['id'], $scope === 'company' ? $allowedCompanyId : null]);

            $pdo->commit();
            json_response(['message' => 'User created', 'userId' => $userId]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Email already exists'], 409);
            }
            json_response(['error' => 'Failed to create user'], 500);
        }
    }

    public static function listUsers(): void
    {
        $claims = self::requireAuth();
        // Treat missing or empty companyId as "no filter" (superadmin sees all; company admin falls back to their company_id)
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam === null || $companyIdParam === '')
            ? ($claims['company_id'] ?? null)
            : (int)$companyIdParam;
        if ($companyId === null && !self::isSuperadmin($claims)) {
            json_response(['error' => 'companyId is required'], 400);
        }
        // Permission: allow either user.manage or user.view for listing (superadmin always allowed)
        if (!self::isSuperadmin($claims)) {
            $canManage = Permissions::userHasPermission($claims, 'user.manage', $companyId);
            $canView = Permissions::userHasPermission($claims, 'user.view', $companyId);
            if (!$canManage && !$canView) {
                json_response(['error' => 'Insufficient permissions'], 403);
            }
        }
        $pdo = db();
        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        if ($companyId === null) {
            // Superadmin or unscoped: list ALL users (both global and company), optionally filtered by q
            if ($q !== '') {
                $like = '%' . $q . '%';
                $sql = "SELECT u.id, u.email, u.full_name AS fullName,u.employee_number AS employeeNumber, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName,
                               r.name AS roleName, r.scope AS roleScope
                        FROM users u
                        LEFT JOIN companies c ON u.company_id = c.id
                        LEFT JOIN user_roles ur ON u.id = ur.user_id
                        LEFT JOIN roles r ON ur.role_id = r.id
                        WHERE (u.email LIKE ? OR u.full_name LIKE ?)
                        ORDER BY u.id DESC
                        LIMIT $limit OFFSET $offset";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$like, $like]);
            } else {
                $sql = "SELECT u.id, u.email, u.full_name AS fullName, u.employee_number AS employeeNumber, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName,
                               r.name AS roleName, r.scope AS roleScope
                        FROM users u
                        LEFT JOIN companies c ON u.company_id = c.id
                        LEFT JOIN user_roles ur ON u.id = ur.user_id
                        LEFT JOIN roles r ON ur.role_id = r.id
                        ORDER BY u.id DESC
                        LIMIT $limit OFFSET $offset";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([]);
            }
        } else {
            if ($q !== '') {
                $like = '%' . $q . '%';
                // Include both company-scoped users and global users for visibility (e.g., superadmin)
                $sql = "SELECT u.id, u.email, u.full_name AS fullName,u.employee_number AS employeeNumber, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName,
                               r.name AS roleName, r.scope AS roleScope
                        FROM users u
                        LEFT JOIN companies c ON u.company_id = c.id
                        LEFT JOIN user_roles ur ON u.id = ur.user_id
                        LEFT JOIN roles r ON ur.role_id = r.id
                        WHERE (u.company_id = ? OR u.company_id IS NULL)
                          AND (u.email LIKE ? OR u.full_name LIKE ?)
                        ORDER BY u.id DESC
                        LIMIT $limit OFFSET $offset";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$companyId, $like, $like]);
            } else {
                // Include both company-scoped users and global users when a company is selected
                $sql = "SELECT u.id, u.email, u.full_name AS fullName,u.employee_number AS employeeNumber, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName,
                               r.name AS roleName, r.scope AS roleScope
                        FROM users u
                        LEFT JOIN companies c ON u.company_id = c.id
                        LEFT JOIN user_roles ur ON u.id = ur.user_id
                        LEFT JOIN roles r ON ur.role_id = r.id
                        WHERE (u.company_id = ? OR u.company_id IS NULL)
                        ORDER BY u.id DESC
                        LIMIT $limit OFFSET $offset";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$companyId]);
            }
        }
        $rows = $stmt->fetchAll();
        // Derive firstName/lastName from fullName for UI convenience
        $items = array_map(function($r) {
            $full = trim((string)($r['fullName'] ?? ''));
            $first = '';
            $last = '';
            if ($full !== '') {
                $parts = preg_split('/\s+/', $full, 2);
                $first = $parts[0] ?? '';
                $last = $parts[1] ?? '';
            }
            $r['firstName'] = $first;
            $r['lastName'] = $last;
            $r['companyName'] = $r['companyName'] ?? '';
            $r['roleName'] = $r['roleName'] ?? '';
            $r['roleScope'] = $r['roleScope'] ?? '';
            return $r;
        }, $rows);
        json_response(['items' => $items, 'limit' => $limit, 'offset' => $offset]);
    }

    public static function deactivateUser(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        if (!$user) { json_response(['error' => 'Not found'], 404); }
        $companyId = $user['companyId'] !== null ? (int)$user['companyId'] : null;
        if (!self::isSuperadmin($claims)) {
            if ($companyId === null || ($claims['company_id'] ?? null) !== $companyId) {
                json_response(['error' => 'Forbidden'], 403);
            }
            if (!Permissions::userHasPermission($claims, 'user.manage', $companyId)) {
                json_response(['error' => 'Insufficient permissions'], 403);
            }
        }
        $pdo->prepare('UPDATE users SET is_active = 0 WHERE id = ?')->execute([$id]);
        json_response(['message' => 'User deactivated']);
    }

    public static function updateUser(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId, email FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        if (!$user) { json_response(['error' => 'Not found'], 404); }
        $companyId = $user['companyId'] !== null ? (int)$user['companyId'] : null;
        if (!self::isSuperadmin($claims)) {
            if ($companyId === null || ($claims['company_id'] ?? null) !== $companyId) {
                json_response(['error' => 'Forbidden'], 403);
            }
            if (!Permissions::userHasPermission($claims, 'user.manage', $companyId)) {
                json_response(['error' => 'Insufficient permissions'], 403);
            }
        }
        $input = json_input();
        $firstName = trim($input['firstName'] ?? '');
        $lastName = trim($input['lastName'] ?? '');
        $employeeNumber = trim($input['employeeNumber'] ?? '');
        $fullName = trim($input['fullName'] ?? (($firstName !== '' || $lastName !== '') ? trim($firstName . ' ' . $lastName) : ''));
        $roleName = trim($input['role'] ?? '');
        $companyIdNew = isset($input['companyId']) ? (int)$input['companyId'] : $companyId;

        if ($roleName === '') {
            json_response(['error' => 'Role is required'], 400);
        }

        try {
            $pdo->beginTransaction();
            // Update user details
            $stmt = $pdo->prepare('UPDATE users SET full_name = ?, company_id = ?, employee_number = ? WHERE id = ?');
            $stmt->execute([$fullName, $companyIdNew,$employeeNumber, $id]);

            // Update role if provided
            if ($roleName !== '') {
                $scope = $roleName === 'superadmin' ? 'global' : 'company';
                $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = ? AND scope = ? LIMIT 1');
                $roleStmt->execute([$roleName, $scope]);
                $role = $roleStmt->fetch();
                if (!$role) {
                    throw new Exception('Role not found');
                }
                // Remove existing role
                $pdo->prepare('DELETE FROM user_roles WHERE user_id = ?')->execute([$id]);
                // Add new role
                $pdo->prepare('INSERT INTO user_roles (user_id, role_id, company_id) VALUES (?, ?, ?)')->execute([$id, (int)$role['id'], $scope === 'company' ? $companyIdNew : null]);
            }

            $pdo->commit();
            json_response(['message' => 'User updated']);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_response(['error' => 'Failed to update user'], 500);
        }
    }

    public static function deleteUser(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        if (!$user) { json_response(['error' => 'Not found'], 404); }
        $companyId = $user['companyId'] !== null ? (int)$user['companyId'] : null;
        if (!self::isSuperadmin($claims)) {
            if ($companyId === null || ($claims['company_id'] ?? null) !== $companyId) {
                json_response(['error' => 'Forbidden'], 403);
            }
            if (!Permissions::userHasPermission($claims, 'user.manage', $companyId)) {
                json_response(['error' => 'Insufficient permissions'], 403);
            }
        }
        try {
            $pdo->beginTransaction();
            // Delete user roles first
            $pdo->prepare('DELETE FROM user_roles WHERE user_id = ?')->execute([$id]);
            // Delete user
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            $pdo->commit();
            json_response(['message' => 'User deleted']);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_response(['error' => 'Failed to delete user'], 500);
        }
    }
    public static function stats(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        // Optional company filter; if not superadmin, default to claim's company_id
        $companyId = isset($_GET['companyId']) && $_GET['companyId'] !== ''
            ? (int)$_GET['companyId']
            : ($claims['company_id'] ?? null);

        $isSuper = self::isSuperadmin($claims);
        if (!$isSuper && $companyId === null) {
            // Non-super must be scoped to a company
            $companyId = $claims['company_id'] ?? null;
        }

        // Users count
        if ($companyId !== null) {
            $stUsers = $pdo->prepare('SELECT COUNT(*) FROM users WHERE company_id = ?');
            $stUsers->execute([$companyId]);
            $stActive = $pdo->prepare('SELECT COUNT(*) FROM users WHERE company_id = ? AND is_active = 1');
            $stActive->execute([$companyId]);
        } else {
            $stUsers = $pdo->query('SELECT COUNT(*) FROM users');
            $stActive = $pdo->query('SELECT COUNT(*) FROM users WHERE is_active = 1');
        }
        $totalUsers = (int)$stUsers->fetchColumn();
        $activeUsers = (int)$stActive->fetchColumn();

        // Roles and permissions are global
        $totalRoles = (int)$pdo->query('SELECT COUNT(*) FROM roles')->fetchColumn();
        $totalPermissions = (int)$pdo->query('SELECT COUNT(*) FROM permissions')->fetchColumn();

        json_response([
            'totalUsers' => $totalUsers,
            'activeUsers' => $activeUsers,
            'totalRoles' => $totalRoles,
            'totalPermissions' => $totalPermissions,
            'scopedCompanyId' => $companyId,
        ]);
    }

    // Removed duplicate listRoles method

    public static function listPermissions(): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        if ($q !== '') {
            $like = '%' . $q . '%';
            $sql = "SELECT id, name FROM permissions WHERE name LIKE ? ORDER BY name LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$like]);
        } else {
            $sql = "SELECT id, name FROM permissions ORDER BY name LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([]);
        }
        $rows = $stmt->fetchAll();
        json_response(['items' => $rows, 'limit' => $limit, 'offset' => $offset]);
    }

    public static function createPermission(): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $input = json_input();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            json_response(['error' => 'Name is required'], 400);
        }
        $pdo = db();
        try {
            $stmt = $pdo->prepare('INSERT INTO permissions (name) VALUES (?)');
            $stmt->execute([$name]);
            $id = (int)$pdo->lastInsertId();
            json_response(['message' => 'Permission created', 'id' => $id]);
        } catch (Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Permission already exists'], 409);
            }
            json_response(['error' => 'Failed to create permission'], 500);
        }
    }

    public static function updatePermission(int $id): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM permissions WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            json_response(['error' => 'Not found'], 404);
        }
        $input = json_input();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            json_response(['error' => 'Name is required'], 400);
        }
        try {
            $stmt = $pdo->prepare('UPDATE permissions SET name = ? WHERE id = ?');
            $stmt->execute([$name, $id]);
            json_response(['message' => 'Permission updated']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to update permission'], 500);
        }
    }

    public static function deletePermission(int $id): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM permissions WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            json_response(['error' => 'Not found'], 404);
        }
        try {
            $pdo->prepare('DELETE FROM permissions WHERE id = ?')->execute([$id]);
            json_response(['message' => 'Permission deleted']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to delete permission'], 500);
        }
    }

    public static function listRoles(): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        if ($q !== '') {
            $like = '%' . $q . '%';
            $sql = "SELECT id, name, scope FROM roles WHERE name LIKE ? ORDER BY scope, name LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$like]);
        } else {
            $sql = "SELECT id, name, scope FROM roles ORDER BY scope, name LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([]);
        }
        $rows = $stmt->fetchAll();
        json_response(['items' => $rows, 'limit' => $limit, 'offset' => $offset]);
    }

    public static function createRole(): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $input = json_input();
        $name = trim($input['name'] ?? '');
        $scope = trim($input['scope'] ?? '');
        if ($name === '' || $scope === '') {
            json_response(['error' => 'Name and scope are required'], 400);
        }
        if (!in_array($scope, ['global', 'company'])) {
            json_response(['error' => 'Scope must be global or company'], 400);
        }
        $pdo = db();
        try {
            $stmt = $pdo->prepare('INSERT INTO roles (name, scope) VALUES (?, ?)');
            $stmt->execute([$name, $scope]);
            $id = (int)$pdo->lastInsertId();
            json_response(['message' => 'Role created', 'id' => $id]);
        } catch (Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Role already exists'], 409);
            }
            json_response(['error' => 'Failed to create role'], 500);
        }
    }

    public static function updateRole(int $id): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            json_response(['error' => 'Not found'], 404);
        }
        $input = json_input();
        $name = trim($input['name'] ?? '');
        $scope = trim($input['scope'] ?? '');
        if ($name === '' || $scope === '') {
            json_response(['error' => 'Name and scope are required'], 400);
        }
        if (!in_array($scope, ['global', 'company'])) {
            json_response(['error' => 'Scope must be global or company'], 400);
        }
        try {
            $stmt = $pdo->prepare('UPDATE roles SET name = ?, scope = ? WHERE id = ?');
            $stmt->execute([$name, $scope, $id]);
            json_response(['message' => 'Role updated']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to update role'], 500);
        }
    }

    public static function deleteRole(int $id): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            json_response(['error' => 'Not found'], 404);
        }
        try {
            $pdo->beginTransaction();
            // Delete role permissions first
            $pdo->prepare('DELETE FROM role_permissions WHERE role_id = ?')->execute([$id]);
            // Delete user roles first
            $pdo->prepare('DELETE FROM user_roles WHERE role_id = ?')->execute([$id]);
            // Delete role
            $pdo->prepare('DELETE FROM roles WHERE id = ?')->execute([$id]);
            $pdo->commit();
            json_response(['message' => 'Role deleted']);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_response(['error' => 'Failed to delete role'], 500);
        }
    }

    // Role-Permission Assignment endpoints
    public static function getRolePermissions(int $roleId): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();

        // Check if role exists
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE id = ?');
        $stmt->execute([$roleId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Role not found'], 404); }

        // Get permissions for this role
        $stmt = $pdo->prepare('
            SELECT p.id, p.name, p.description
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = ?
            ORDER BY p.name
        ');
        $stmt->execute([$roleId]);
        $permissions = $stmt->fetchAll();

        json_response($permissions);
    }

    public static function assignPermissionToRole(int $roleId): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();

        $input = json_input();
        $permissionId = $input['permission_id'] ?? null;
        if (!$permissionId) { json_response(['error' => 'permission_id required'], 400); }

        // Check if role exists
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE id = ?');
        $stmt->execute([$roleId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Role not found'], 404); }

        // Check if permission exists
        $stmt = $pdo->prepare('SELECT id FROM permissions WHERE id = ?');
        $stmt->execute([$permissionId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Permission not found'], 404); }

        // Check if assignment already exists (role_permissions has composite PK, no standalone id column)
        $stmt = $pdo->prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ? LIMIT 1');
        $stmt->execute([$roleId, $permissionId]);
        if ($stmt->fetchColumn()) { json_response(['error' => 'Permission already assigned to role'], 409); }

        // Create assignment
        $stmt = $pdo->prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
        $stmt->execute([$roleId, $permissionId]);

        json_response(['message' => 'Permission assigned to role'], 201);
    }

    public static function removePermissionFromRole(int $roleId, int $permissionId): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $pdo = db();

        // Check if role exists
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE id = ?');
        $stmt->execute([$roleId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Role not found'], 404); }

        // Check if permission exists
        $stmt = $pdo->prepare('SELECT id FROM permissions WHERE id = ?');
        $stmt->execute([$permissionId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Permission not found'], 404); }

        // Remove assignment
        $stmt = $pdo->prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?');
        $stmt->execute([$roleId, $permissionId]);

        json_response(['message' => 'Permission removed from role']);
    }

    public static function bulkCreateUsers(): void
    {
        $claims = self::requireAuth();
        if (!self::isSuperadmin($claims)) {
            json_response(['error' => 'Superadmin required'], 403);
        }
        $input = json_input();
        $users = $input['users'] ?? [];
        if (!is_array($users) || empty($users)) {
            json_response(['error' => 'Users array required'], 400);
        }
        $pdo = db();
        $created = 0;
        $errors = [];
        foreach ($users as $idx => $user) {
            try {
                $email = trim($user['email'] ?? '');
                $firstName = trim($user['firstname'] ?? $user['firstName'] ?? '');
                $lastName = trim($user['lastname'] ?? $user['lastName'] ?? '');
                $employeeNumber = trim($user['employeenumber'] ?? $user['employeeNumber'] ?? '');
                $password = $user['password'] ?? '';
                $role = trim($user['role'] ?? '');
                $companyName = trim($user['companyname'] ?? $user['companyName'] ?? '');
                if (!$email || !$password || !$role) {
                    $errors[] = "Row " . ($idx + 1) . ": Missing required fields";
                    continue;
                }
                // Find or create company
                $companyId = null;
                if ($companyName) {
                    $stmt = $pdo->prepare('SELECT id FROM companies WHERE name = ?');
                    $stmt->execute([$companyName]);
                    $row = $stmt->fetch();
                    if ($row) {
                        $companyId = (int)$row['id'];
                    } else {
                        $stmt = $pdo->prepare('INSERT INTO companies (name) VALUES (?)');
                        $stmt->execute([$companyName]);
                        $companyId = (int)$pdo->lastInsertId();
                    }
                }
                // Hash password
                $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
                // Create user
                $stmt = $pdo->prepare('INSERT INTO users (email, full_name,employee_number, password_hash, company_id, is_active) VALUES (?, ?, ?, ?,?, 1)');
                $fullName = trim($firstName . ' ' . $lastName);
                $stmt->execute([$email, $fullName,$employeeNumber, $hashedPassword, $companyId]);
                $userId = (int)$pdo->lastInsertId();
                // Assign role
                $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
                $stmt->execute([$role]);
                $roleRow = $stmt->fetch();
                if ($roleRow) {
                    $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')->execute([$userId, $roleRow['id']]);
                }
                $created++;
            } catch (Throwable $e) {
                $errors[] = "Row " . ($idx + 1) . ": " . $e->getMessage();
            }
        }
        json_response(['created' => $created, 'errors' => $errors]);
    }
}
 

