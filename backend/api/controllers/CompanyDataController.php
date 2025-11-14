<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class CompanyDataController
{
    // ----- Auth helpers -----
    private static function requireAuth(): array
    {
        global $env;
        $token = null;
        $rawAuth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['Authorization'] ?? '';
        $redirAuth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        $auth = $rawAuth ?: $redirAuth;
        if ($auth && preg_match('/^Bearer\s+(.*)$/i', $auth, $m)) {
            $token = $m[1];
        }
        if ($token === null) {
            if (isset($_SERVER['HTTP_X_AUTH_TOKEN'])) {
                $token = (string)$_SERVER['HTTP_X_AUTH_TOKEN'];
            } else {
                $body = json_input();
                if (isset($body['token'])) {
                    $token = (string)$body['token'];
                }
            }
        }
        if ($token === null || $token === '') {
            json_response(['error' => 'Unauthorized'], 401);
        }
        try {
            return Jwt::verify($token, $env['JWT_SECRET'], $env['JWT_ISS']);
        } catch (Throwable $e) {
            json_response(['error' => 'Unauthorized'], 401);
        }
    }

    private static function requireCompanyManage(array $claims): void
    {
        $isSuperAdmin = false;
        $roles = $claims['roles'] ?? [];
        foreach ($roles as $role) {
            if (($role['name'] ?? '') === 'superadmin' && ($role['scope'] ?? '') === 'global') {
                $isSuperAdmin = true;
                break;
            }
        }
        if (!$isSuperAdmin && !Permissions::userHasPermission($claims, 'company.manage', null)) {
            json_response(['error' => 'Insufficient permissions'], 403);
        }
    }

    private static function getUserId(array $claims): ?int
    {
        $id = $claims['sub'] ?? ($claims['user_id'] ?? null);
        return $id !== null ? (int)$id : null;
    }

    // ----- Schema helpers -----
    private static function sanitizeIdent(string $raw): string
    {
        $id = strtolower(preg_replace('/[^a-zA-Z0-9_]+/', '_', $raw));
        $id = trim($id, '_');
        if ($id === '' || is_numeric($id[0])) {
            $id = 'f_' . $id;
        }
        return $id;
    }

    private static function tableExists(PDO $pdo, string $table): bool
    {
        $st = $pdo->prepare("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1");
        $st->execute([$table]);
        return (bool)$st->fetchColumn();
    }

    private static function listColumns(PDO $pdo, string $table): array
    {
        $st = $pdo->prepare("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION");
        $st->execute([$table]);
        return array_map(fn($r) => $r['COLUMN_NAME'], $st->fetchAll());
    }

    private static function tableFromRegistry(PDO $pdo, int $companyId, string $typeKey): ?string
    {
        $st = $pdo->prepare("SELECT table_name FROM company_table_registry WHERE company_id = ? AND type_key = ?");
        $st->execute([$companyId, $typeKey]);
        $row = $st->fetch();
        return $row ? (string)$row['table_name'] : null;
    }

    private static function defaultTableName(int $companyId, string $typeKey): string
    {
        return 'c' . $companyId . '_' . self::sanitizeIdent($typeKey);
    }

    private static function resolveTable(PDO $pdo, int $companyId, string $typeKey): ?string
    {
        $t = self::tableFromRegistry($pdo, $companyId, $typeKey);
        if ($t) return $t;
        // fallback to convention if registry missing
        $t = self::defaultTableName($companyId, $typeKey);
        return self::tableExists($pdo, $t) ? $t : null;
    }

    private static function loadStructure(PDO $pdo, int $companyId): ?array
    {
        $st = $pdo->prepare("SELECT structure_json FROM machine_structures WHERE company_id = ?");
        $st->execute([$companyId]);
        $row = $st->fetch();
        if (!$row) return null;
        $s = json_decode($row['structure_json'], true);
        return is_array($s) ? $s : null;
    }

    private static function buildTypeMaps(array $s): array
    {
        $types = [];
        foreach (($s['nodeTypes'] ?? []) as $nt) {
            if (is_array($nt) && isset($nt['key'])) {
                $types[$nt['key']] = $nt;
            }
        }
        $childParent = [];
        $multiParent = [];
        foreach (($s['rules'] ?? []) as $r) {
            $p = $r['parent'] ?? null;
            $c = $r['child'] ?? null;
            if (!$p || !$c) continue;
            if (!isset($childParent[$c])) {
                $childParent[$c] = $p;
            } elseif ($childParent[$c] !== $p) {
                $multiParent[$c] = true;
            }
        }
        return [$types, $childParent, $multiParent];
    }

    /**
     * Returns true if the type appears as a direct child of root in the saved tree.
     * This allows creating top-level rows even if rules define a parent.
     */
    private static function usedAtTopLevel(array $s, string $typeKey): bool
    {
        $tree = $s['tree'] ?? null;
        if (!is_array($tree)) return false;
        $children = $tree['children'] ?? null;
        if (!is_array($children)) return false;
        foreach ($children as $ch) {
            if (is_array($ch) && ($ch['type'] ?? null) === $typeKey) {
                return true;
            }
        }
        return false;
    }

    private static function parentColumn(string $parentType): string
    {
       return self::sanitizeIdent($parentType) . '_id';
    }

    private static function coerceValue($value, string $type)
    {
        switch (strtolower($type)) {
            case 'integer': return is_null($value) || $value === '' ? null : (int)$value;
            case 'number': return is_null($value) || $value === '' ? null : (float)$value;
            case 'boolean': return ($value === true || $value === 'true' || $value === 1 || $value === '1') ? 1 : 0;
            case 'date': return is_null($value) || $value === '' ? null : (string)$value; // expect 'YYYY-MM-DD' or full datetime
            case 'json':
                if (is_string($value)) return $value;
                return json_encode($value, JSON_UNESCAPED_UNICODE);
            case 'string':
            default:
                return is_null($value) ? null : (string)$value;
        }
    }

    private static function ensureCompany(PDO $pdo, int $companyId): void
    {
        $st = $pdo->prepare("SELECT id FROM companies WHERE id = ?");
        $st->execute([$companyId]);
       if (!$st->fetch()) { json_response(['error' => 'Company not found'], 404); }
    }

    // ----- Endpoints -----
    public static function list(int $companyId, string $typeKey): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        self::ensureCompany($pdo, $companyId);

        $structure = self::loadStructure($pdo, $companyId);
        if (!$structure) { json_response(['items' => [], 'total' => 0]); }
        [$types, $childParent, $multiParent] = self::buildTypeMaps($structure);
        if (!isset($types[$typeKey])) { json_response(['error' => 'Unknown type'], 404); }

        $table = self::resolveTable($pdo, $companyId, $typeKey);
        if (!$table) { json_response(['error' => 'Table not found for type'], 404); }

        $where = [];
        $params = [];
        // Optional id filter
        if (isset($_GET['id']) && ctype_digit((string)$_GET['id'])) {
            $where[] = "`id` = ?";
            $params[] = (int)$_GET['id'];
        }
        // Parent filter if single parent
        if (!isset($multiParent[$typeKey]) && isset($childParent[$typeKey])) {
            $parent = $childParent[$typeKey];
            $parentCol = self::parentColumn($parent);
            if (isset($_GET[$parentCol]) && ctype_digit((string)$_GET[$parentCol])) {
                $where[] = "`$parentCol` = ?";
                $params[] = (int)$_GET[$parentCol];
            }
        }

        $limit = isset($_GET['limit']) && ctype_digit((string)$_GET['limit']) ? min(500, (int)$_GET['limit']) : 100;
        $offset = isset($_GET['offset']) && ctype_digit((string)$_GET['offset']) ? (int)$_GET['offset'] : 0;

        $sql = "SELECT * FROM `$table`";
        if ($where) { $sql .= " WHERE " . implode(' AND ', $where); }
        $sql .= " ORDER BY `id` DESC LIMIT $limit OFFSET $offset";
        $rows = $pdo->prepare($sql);
        $rows->execute($params);
        $items = $rows->fetchAll();

        // total count (optional)
        $countSql = "SELECT COUNT(*) AS c FROM `$table`" . ($where ? " WHERE " . implode(' AND ', $where) : "");
        $st = $pdo->prepare($countSql);
        $st->execute($params);
        $total = (int)($st->fetch()['c'] ?? 0);

        json_response(['items' => $items, 'total' => $total]);
    }

    public static function create(int $companyId, string $typeKey): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $userId = self::getUserId($claims);
        $pdo = db();
        self::ensureCompany($pdo, $companyId);

        $structure = self::loadStructure($pdo, $companyId);
        if (!$structure) { json_response(['error' => 'No structure for company'], 400); }
        [$types, $childParent, $multiParent] = self::buildTypeMaps($structure);
        $def = $types[$typeKey] ?? null;
        if (!$def) { json_response(['error' => 'Unknown type'], 404); }

        $table = self::resolveTable($pdo, $companyId, $typeKey);
        if (!$table) { json_response(['error' => 'Table not found for type'], 404); }
        $columns = self::listColumns($pdo, $table);
 
        $input = json_input();
        // Normalize payload keys: accept both attr_name and name
        if (is_array($input)) {
            $normalized = $input;
            foreach ($input as $k => $v) {
                if (is_string($k) && str_starts_with($k, 'attr_')) {
                    $normalized[substr($k, 5)] = $v;
                }
            }
            $input = $normalized;
        }
 
       // Parent requirement if single parent, unless this type is also used at top level in the saved tree
       $topLevel = self::usedAtTopLevel($structure, $typeKey);
       if (!isset($multiParent[$typeKey]) && isset($childParent[$typeKey]) && !$topLevel) {
           $parent = $childParent[$typeKey];
           $parentCol = self::parentColumn($parent);
           if (!isset($input[$parentCol]) || !ctype_digit((string)$input[$parentCol])) {
               json_response(['error' => "Missing or invalid $parentCol"], 422);
           }
       }

        // Build insert fields from attributes
        $attrDefs = [];
        foreach (($def['attributes'] ?? []) as $a) {
            if (is_array($a) && isset($a['key'])) {
                $attrDefs[$a['key']] = $a;
            }
        }

        // Validate required attributes
        foreach ($attrDefs as $k => $ad) {
            if (!empty($ad['required']) && !array_key_exists($k, $input)) {
                json_response(['error' => "Missing required attribute '$k'"], 422);
            }
        }

        // If user provided attribute values but the physical columns don't exist yet,
        // fail fast with a clear message to Run Schema.
        $providedAttrKeys = [];
        foreach ($attrDefs as $k => $ad) {
            if (array_key_exists($k, $input)) {
                $providedAttrKeys[] = $k;
            }
        }
        if (!empty($providedAttrKeys)) {
            $missingCols = [];
            foreach ($providedAttrKeys as $k) {
                $col = self::sanitizeIdent($k);
                if (!in_array($col, $columns, true)) {
                    $missingCols[] = $k;
                }
            }
            if (!empty($missingCols)) {
                json_response([
                    'error' => 'Attributes not materialized. Open Machine Structure and click "Run Schema" for this company.',
                    'missing' => $missingCols
                ], 422);
            }
        }

        $fields = [];
        $values = [];

        // Include parent col only if provided; omit when top-level allowed to keep NULL
        if (!isset($multiParent[$typeKey]) && isset($childParent[$typeKey])) {
            $parentCol = self::parentColumn($childParent[$typeKey]);
            if (in_array($parentCol, $columns, true)) {
                if (array_key_exists($parentCol, $input) && $input[$parentCol] !== '' && $input[$parentCol] !== null) {
                    $fields[] = "`$parentCol`";
                    $values[] = (int)$input[$parentCol];
                }
            }
        }

        // Attributes
        foreach ($attrDefs as $k => $ad) {
            $col = self::sanitizeIdent($k);
            if (!in_array($col, $columns, true)) continue;
            if (!array_key_exists($k, $input)) continue;
            $fields[] = "`$col`";
            $values[] = self::coerceValue($input[$k], (string)($ad['type'] ?? 'string'));
        }

        // Common audit columns if exist
        if (in_array('created_by', $columns, true)) { $fields[] = '`created_by`'; $values[] = $userId; }
        if (in_array('updated_by', $columns, true)) { $fields[] = '`updated_by`'; $values[] = $userId; }

        if (!$fields) {
            json_response(['error' => 'No insertable fields'], 422);
        }

        $placeholders = implode(',', array_fill(0, count($fields), '?'));
        $sql = "INSERT INTO `$table` (" . implode(',', $fields) . ") VALUES ($placeholders)";
        try {
            $st = $pdo->prepare($sql);
            $st->execute($values);
            $id = (int)$pdo->lastInsertId();
        } catch (Throwable $e) {
            json_response(['error' => 'Insert failed', 'detail' => $e->getMessage()], 409);
        }

        self::get($companyId, $typeKey, $id);
    }

    public static function get(int $companyId, string $typeKey, int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        self::ensureCompany($pdo, $companyId);
        $table = self::resolveTable($pdo, $companyId, $typeKey);
        if (!$table) { json_response(['error' => 'Table not found for type'], 404); }
        $st = $pdo->prepare("SELECT * FROM `$table` WHERE id = ? LIMIT 1");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) { json_response(['error' => 'Not found'], 404); }
        json_response($row);
    }

    public static function update(int $companyId, string $typeKey, int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $userId = self::getUserId($claims);
        $pdo = db();
        self::ensureCompany($pdo, $companyId);

        $structure = self::loadStructure($pdo, $companyId);
        if (!$structure) { json_response(['error' => 'No structure for company'], 400); }
        [$types] = self::buildTypeMaps($structure);
        $def = $types[$typeKey] ?? null;
        if (!$def) { json_response(['error' => 'Unknown type'], 404); }

        $table = self::resolveTable($pdo, $companyId, $typeKey);
        if (!$table) { json_response(['error' => 'Table not found for type'], 404); }
        $columns = self::listColumns($pdo, $table);
 
        $input = json_input();
        // Normalize payload keys: accept both attr_* and raw keys
        if (is_array($input)) {
            $normalized = $input;
            foreach ($input as $k => $v) {
                if (is_string($k) && str_starts_with($k, 'attr_')) {
                    $normalized[substr($k, 5)] = $v;
                }
            }
            $input = $normalized;
        }
 
        $attrDefs = [];
        foreach (($def['attributes'] ?? []) as $a) {
            if (is_array($a) && isset($a['key'])) {
                $attrDefs[$a['key']] = $a;
            }
        }

        // If updating attribute values but physical columns are missing, instruct to Run Schema
        $missingCols = [];
        $hasAttrInPayload = false;
        foreach ($attrDefs as $k => $ad) {
            if (array_key_exists($k, $input)) {
                $hasAttrInPayload = true;
                $col = self::sanitizeIdent($k);
                if (!in_array($col, $columns, true)) {
                    $missingCols[] = $k;
                }
            }
        }
        if ($hasAttrInPayload && !empty($missingCols)) {
            json_response([
                'error' => 'Attributes not materialized. Open Machine Structure and click "Run Schema" for this company.',
                'missing' => $missingCols
            ], 422);
        }

        $sets = [];
        $values = [];

        foreach ($attrDefs as $k => $ad) {
            $col = self::sanitizeIdent($k);
            if (!in_array($col, $columns, true)) continue;
            if (!array_key_exists($k, $input)) continue;
            $sets[] = "`$col` = ?";
            $values[] = self::coerceValue($input[$k], (string)($ad['type'] ?? 'string'));
        }

        if (in_array('updated_by', $columns, true)) {
            $sets[] = '`updated_by` = ?';
            $values[] = $userId;
        }

        if (!$sets) { json_response(['error' => 'No updatable fields'], 422); }

        $values[] = $id;
        $sql = "UPDATE `$table` SET " . implode(', ', $sets) . " WHERE id = ?";
        try {
            $st = $pdo->prepare($sql);
            $st->execute($values);
        } catch (Throwable $e) {
            json_response(['error' => 'Update failed', 'detail' => $e->getMessage()], 409);
        }

        self::get($companyId, $typeKey, $id);
    }

    public static function delete(int $companyId, string $typeKey, int $id): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        self::ensureCompany($pdo, $companyId);
        $table = self::resolveTable($pdo, $companyId, $typeKey);
        if (!$table) { json_response(['error' => 'Table not found for type'], 404); }
        try {
            $st = $pdo->prepare("DELETE FROM `$table` WHERE id = ?");
            $st->execute([$id]);
        } catch (Throwable $e) {
            json_response(['error' => 'Delete failed', 'detail' => $e->getMessage()], 409);
        }
        json_response(['deleted' => true, 'id' => $id]);
    }
}

?>