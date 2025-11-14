<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class AssetsController
{
    private static function requireAuth(): array
    {
        global $env;
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.*)$/i', $auth, $m)) {
            json_response(['error' => 'Unauthorized'], 401);
        }
        try {
            return Jwt::verify($m[1], $env['JWT_SECRET'], $env['JWT_ISS']);
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

    // Demo endpoint: requires asset.view; optionally scoped to companyId
    public static function listDemo(): void
    {
        $claims = self::requireAuth();
        $companyId = isset($_GET['companyId']) ? (int)$_GET['companyId'] : ($claims['company_id'] ?? null);
        if ($companyId !== null && !Permissions::userHasPermission($claims, 'asset.view', (int)$companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
        // No real assets yet; return a mock payload to validate permission flow
        $items = [
            ['id' => 1, 'name' => 'Demo Pump', 'companyId' => $companyId],
            ['id' => 2, 'name' => 'Demo Conveyor', 'companyId' => $companyId],
        ];
        json_response(['items' => $items]);
    }

    public static function list(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $isSuper = self::isSuperadmin($claims);

        $companyId = isset($_GET['companyId']) ? (int)$_GET['companyId'] : ($claims['company_id'] ?? null);

        // Superadmin without companyId => list across all companies
        if ($companyId === null && $isSuper) {
            if ($q !== '') {
                $stmt = $pdo->prepare('SELECT id, company_id AS companyId, name, description, created_at, updated_at FROM assets WHERE (name LIKE ? OR description LIKE ?) ORDER BY id DESC LIMIT ? OFFSET ?');
                $like = '%' . $q . '%';
                $stmt->execute([$like, $like, $limit, $offset]);
            } else {
                $stmt = $pdo->prepare('SELECT id, company_id AS companyId, name, description, created_at, updated_at FROM assets ORDER BY id DESC LIMIT ? OFFSET ?');
                $stmt->execute([$limit, $offset]);
            }
            json_response(['items' => $stmt->fetchAll(), 'limit' => $limit, 'offset' => $offset]);
        }

        // Company-scoped listing (default path)
        if ($companyId === null) {
            json_response(['error' => 'companyId is required'], 400);
        }
        if (!Permissions::userHasPermission($claims, 'asset.view', (int)$companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }

        if ($q !== '') {
            $stmt = $pdo->prepare('SELECT id, company_id AS companyId, name, description, created_at, updated_at FROM assets WHERE company_id = ? AND (name LIKE ? OR description LIKE ?) ORDER BY id DESC LIMIT ? OFFSET ?');
            $like = '%' . $q . '%';
            $stmt->execute([$companyId, $like, $like, $limit, $offset]);
        } else {
            $stmt = $pdo->prepare('SELECT id, company_id AS companyId, name, description, created_at, updated_at FROM assets WHERE company_id = ? ORDER BY id DESC LIMIT ? OFFSET ?');
            $stmt->execute([$companyId, $limit, $offset]);
        }
        json_response(['items' => $stmt->fetchAll(), 'limit' => $limit, 'offset' => $offset]);
    }

    public static function create(): void
    {
        $claims = self::requireAuth();
        $input = json_input();
        $companyId = isset($input['companyId']) ? (int)$input['companyId'] : ($claims['company_id'] ?? null);
        $name = trim($input['name'] ?? '');
        $description = isset($input['description']) ? (string)$input['description'] : null;
        if ($companyId === null || $name === '') {
            json_response(['error' => 'companyId and name are required'], 400);
        }
        if (!Permissions::userHasPermission($claims, 'asset.edit', $companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
        $pdo = db();
        $stmt = $pdo->prepare('INSERT INTO assets (company_id, name, description) VALUES (?, ?, ?)');
        $stmt->execute([$companyId, $name, $description]);
        json_response(['message' => 'Asset created', 'id' => (int)$pdo->lastInsertId()], 201);
    }

    public static function get(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId, name, description, created_at, updated_at FROM assets WHERE id = ?');
        $stmt->execute([$id]);
        $asset = $stmt->fetch();
        if (!$asset) { json_response(['error' => 'Not found'], 404); }
        $companyId = (int)$asset['companyId'];
        if (!Permissions::userHasPermission($claims, 'asset.view', $companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
        json_response($asset);
    }

    public static function update(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM assets WHERE id = ?');
        $stmt->execute([$id]);
        $asset = $stmt->fetch();
        if (!$asset) { json_response(['error' => 'Not found'], 404); }
        $companyId = (int)$asset['companyId'];
        if (!Permissions::userHasPermission($claims, 'asset.edit', $companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
        $input = json_input();
        $name = isset($input['name']) ? trim((string)$input['name']) : null;
        $description = array_key_exists('description', $input) ? (string)$input['description'] : null;
        $fields = [];
        $params = [];
        if ($name !== null) { $fields[] = 'name = ?'; $params[] = $name; }
        if ($description !== null) { $fields[] = 'description = ?'; $params[] = $description; }
        if (empty($fields)) { json_response(['error' => 'Nothing to update'], 400); }
        $params[] = $id;
        $sql = 'UPDATE assets SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $pdo->prepare($sql)->execute($params);
        json_response(['message' => 'Asset updated']);
    }

    public static function delete(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM assets WHERE id = ?');
        $stmt->execute([$id]);
        $asset = $stmt->fetch();
        if (!$asset) { json_response(['error' => 'Not found'], 404); }
        $companyId = (int)$asset['companyId'];
        if (!Permissions::userHasPermission($claims, 'asset.edit', $companyId)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
        $pdo->prepare('DELETE FROM assets WHERE id = ?')->execute([$id]);
        json_response(['message' => 'Asset deleted']);
    }
}


