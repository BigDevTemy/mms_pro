<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class CompaniesController
{
    private static function requireAuth(): array
    {
        global $env;

        // Collect debug info to help diagnose missing Authorization on some stacks
        $debug = [
            'sawAuthHeader' => false,
            'sawRedirectAuthHeader' => false,
            'sawApacheAuthHeader' => false,
            'sawXAuthToken' => false,
            'sawQueryToken' => false,
            'sawBodyToken' => false,
            'authSample' => null,
        ];

        $token = null;

        // 1) Standard Authorization header (preferred)
        $rawAuth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['Authorization'] ?? '';
        if ($rawAuth) { $debug['sawAuthHeader'] = true; }
        $redirAuth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($redirAuth) { $debug['sawRedirectAuthHeader'] = true; }

        $auth = $rawAuth ?: $redirAuth;

        // Try apache_request_headers() as last resort to find "Authorization"
        if (!$auth && function_exists('apache_request_headers')) {
            $all = apache_request_headers();
            foreach ($all as $k => $v) {
                if (strtolower($k) === 'authorization') {
                    $auth = $v;
                    $debug['sawApacheAuthHeader'] = true;
                    break;
                }
            }
        }

        if ($auth) { $debug['authSample'] = substr($auth, 0, 20) . '...'; }

        if ($auth && preg_match('/^Bearer\s+(.*)$/i', $auth, $m)) {
            $token = $m[1];
        }

        // 2) X-Auth-Token custom header (fallback)
        if ($token === null) {
            if (isset($_SERVER['HTTP_X_AUTH_TOKEN'])) {
                $token = (string)$_SERVER['HTTP_X_AUTH_TOKEN'];
                $debug['sawXAuthToken'] = true;
            } elseif (function_exists('apache_request_headers')) {
                $all = apache_request_headers();
                foreach ($all as $k => $v) {
                    if (strtolower($k) === 'x-auth-token') {
                        $token = $v;
                        $debug['sawXAuthToken'] = true;
                        break;
                    }
                }
            }
        }

        // 3) token in query/body (dev fallback)
        if ($token === null) {
            if (isset($_GET['token'])) {
                $token = (string)$_GET['token'];
                $debug['sawQueryToken'] = true;
            } else {
                $body = json_input();
                if (isset($body['token'])) {
                    $token = (string)$body['token'];
                    $debug['sawBodyToken'] = true;
                }
            }
        }

        if ($token === null || $token === '') {
            json_response(['error' => 'Unauthorized', 'debug' => $debug], 401);
        }

        try {
            return Jwt::verify($token, $env['JWT_SECRET'], $env['JWT_ISS']);
        } catch (Throwable $e) {
            json_response(['error' => 'Unauthorized', 'debug' => $debug], 401);
        }
    }

    private static function requireCompanyManage(array $claims): void
    {
        // Check if user is superadmin (global scope)
        $isSuperAdmin = false;
        $roles = $claims['roles'] ?? [];
        foreach ($roles as $role) {
            if (($role['name'] ?? '') === 'superadmin' && ($role['scope'] ?? '') === 'global') {
                $isSuperAdmin = true;
                break;
            }
        }

        // Superadmin has all permissions, or check specific permission
        if (!$isSuperAdmin && !Permissions::userHasPermission($claims, 'company.manage', null)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
    }

    public static function list(): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();

        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 10;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';

        if ($q !== '') {
            $like = '%' . $q . '%';
            $sql = "SELECT id, name, created_at, updated_at FROM companies WHERE name LIKE ? ORDER BY id DESC LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$like]);
        } else {
            $sql = "SELECT id, name, created_at, updated_at FROM companies ORDER BY id DESC LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([]);
        }

        $rows = $stmt->fetchAll();

        // Get total count for pagination
        if ($q !== '') {
            $countSql = "SELECT COUNT(*) as total FROM companies WHERE name LIKE ?";
            $countStmt = $pdo->prepare($countSql);
            $countStmt->execute([$like]);
        } else {
            $countSql = "SELECT COUNT(*) as total FROM companies";
            $countStmt = $pdo->prepare($countSql);
            $countStmt->execute([]);
        }
        $total = (int)$countStmt->fetch()['total'];

        json_response(['items' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }

    public static function create(): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $input = json_input();
        $name = trim($input['name'] ?? '');
        if ($name === '') { json_response(['error' => 'name is required'], 400); }
        $pdo = db();
        try {
            $stmt = $pdo->prepare('INSERT INTO companies (name) VALUES (?)');
            $stmt->execute([$name]);
            json_response(['message' => 'Company created', 'id' => (int)$pdo->lastInsertId()], 201);
        } catch (Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Company already exists'], 409);
            }
            json_response(['error' => 'Failed to create company'], 500);
        }
    }

    public static function get(int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, name, created_at, updated_at FROM companies WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { json_response(['error' => 'Not found'], 404); }
        json_response($row);
    }

    public static function update(int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $input = json_input();
        $name = isset($input['name']) ? trim((string)$input['name']) : null;
        if ($name === null) { json_response(['error' => 'Nothing to update'], 400); }
        $pdo = db();
        try {
            $stmt = $pdo->prepare('UPDATE companies SET name = ? WHERE id = ?');
            $stmt->execute([$name, $id]);
            json_response(['message' => 'Company updated']);
        } catch (Throwable $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                json_response(['error' => 'Company already exists'], 409);
            }
            json_response(['error' => 'Failed to update company'], 500);
        }
    }

    public static function delete(int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM companies WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            json_response(['error' => 'Not found'], 404);
        }
        try {
            $pdo->beginTransaction();
            // Delete related data first
            $pdo->prepare('DELETE FROM user_roles WHERE company_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM users WHERE company_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM company_table_registry WHERE company_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM company_schema_versions WHERE company_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM machine_structures WHERE company_id = ?')->execute([$id]);
            // Delete company
            $pdo->prepare('DELETE FROM companies WHERE id = ?')->execute([$id]);
            $pdo->commit();
            json_response(['message' => 'Company deleted']);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_response(['error' => 'Failed to delete company'], 500);
        }
    }
}


