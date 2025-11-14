<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class MachineStructureController
{
    private static function requireAuth(): array
    {
        global $env;
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
        $rawAuth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['Authorization'] ?? '';
        if ($rawAuth) { $debug['sawAuthHeader'] = true; }
        $redirAuth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($redirAuth) { $debug['sawRedirectAuthHeader'] = true; }
        $auth = $rawAuth ?: $redirAuth;
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

    public static function getStructure(int $companyId): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM companies WHERE id = ?');
        $stmt->execute([$companyId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Company not found'], 404); }
        $stmt = $pdo->prepare('SELECT id, company_id, structure_json, version, created_at, updated_at FROM machine_structures WHERE company_id = ?');
        $stmt->execute([$companyId]);
        $row = $stmt->fetch();
        if ($row) {
            $payload = json_decode($row['structure_json'], true);
            json_response([
                'company_id' => (int)$row['company_id'],
                'version' => (int)$row['version'],
                'structure' => $payload,
                'created_at' => $row['created_at'],
                'updated_at' => $row['updated_at'],
            ]);
        } else {
            $default = self::defaultStructure();
            json_response([
                'company_id' => $companyId,
                'version' => 1,
                'structure' => $default,
                'created_at' => null,
                'updated_at' => null,
            ]);
        }
    }

    public static function upsertStructure(int $companyId): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $userId = self::getUserId($claims);
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM companies WHERE id = ?');
        $stmt->execute([$companyId]);
        if (!$stmt->fetch()) { json_response(['error' => 'Company not found'], 404); }
        $input = json_input();
        $structure = $input['structure'] ?? $input;
        if (!is_array($structure)) {
            json_response(['error' => 'Invalid payload, expected object or {structure: {...}}'], 400);
        }
        $errors = [];
        if (!self::validateStructure($structure, $errors)) {
            json_response(['error' => 'Validation failed', 'errors' => $errors], 422);
        }
        $json = json_encode($structure, JSON_UNESCAPED_UNICODE);
        $stmt = $pdo->prepare('SELECT id FROM machine_structures WHERE company_id = ?');
        $stmt->execute([$companyId]);
        $exists = (bool)$stmt->fetchColumn();
        if (!$exists) {
            $ver = isset($input['version']) ? max(1, (int)$input['version']) : 1;
            $stmt = $pdo->prepare('INSERT INTO machine_structures (company_id, structure_json, version, created_by, updated_by) VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([$companyId, $json, $ver, $userId, $userId]);
        } else {
            $stmt = $pdo->prepare('UPDATE machine_structures SET structure_json = ?, version = version + 1, updated_by = ? WHERE company_id = ?');
            $stmt->execute([$json, $userId, $companyId]);
        }
        self::getStructure($companyId);
    }

    private static function defaultStructure(): array
    {
        return [
            'nodeTypes' => [
                ['key' => 'line', 'label' => 'Line', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
                ['key' => 'machine', 'label' => 'Machine', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
                ['key' => 'project', 'label' => 'Project', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
                ['key' => 'unit', 'label' => 'Unit', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
                 ['key' => 'subunit', 'label' => 'Subunit', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
                ['key' => 'subline', 'label' => 'Subline', 'attributes' => [['key' => 'name', 'type' => 'string', 'required' => true]]],
            ],
            'rules' => [],
            'tree' => ['id' => 'root', 'type' => 'root', 'children' => []],
        ];
    }

    private static function validateStructure(array $s, array &$errors): bool
    {
        $errors = [];
        if (!isset($s['nodeTypes']) || !is_array($s['nodeTypes'])) {
            $errors[] = 'nodeTypes must be an array';
        }
        if (!isset($s['rules']) || !is_array($s['rules'])) {
            $errors[] = 'rules must be an array';
        }
        if (!isset($s['tree']) || !is_array($s['tree'])) {
            $errors[] = 'tree must be an object';
        }
        if ($errors) { return false; }
        $types = [];
        foreach ($s['nodeTypes'] as $nt) {
            if (!is_array($nt)) { $errors[] = 'nodeTypes items must be objects'; continue; }
            $key = $nt['key'] ?? null;
            if (!is_string($key) || $key === '') { $errors[] = 'nodeType.key required'; continue; }
            if (isset($types[$key])) { $errors[] = "Duplicate nodeType.key: $key"; continue; }
            $types[$key] = $nt;
        }
        foreach ($s['rules'] as $r) {
            if (!is_array($r)) { $errors[] = 'rules items must be objects'; continue; }
            $p = $r['parent'] ?? null;
            $c = $r['child'] ?? null;
            if (!isset($types[$p])) { $errors[] = "Rule parent not defined: $p"; }
            if (!isset($types[$c])) { $errors[] = "Rule child not defined: $c"; }
        }
        $allowed = [];
        foreach ($s['rules'] as $r) {
            if (isset($r['parent'], $r['child'])) {
                $allowed[$r['parent']][$r['child']] = true;
            }
        }
        // Flexible ordering: do not enforce parent→child rules during validation
        $enforceRules = false;
        self::validateNode($s['tree'], 'root', $types, $allowed, $enforceRules, $errors);
        return count($errors) === 0;
    }

    private static function validateNode($node, string $parentType, array $types, array $allowed, bool $enforceRules, array &$errors, string $path = 'root'): void
    {
        if (!is_array($node)) { $errors[] = "Node at $path must be object"; return; }
        $type = $node['type'] ?? null;
        if (!is_string($type)) { $errors[] = "Node at $path missing type"; return; }
        if ($type !== 'root' && !isset($types[$type])) { $errors[] = "Unknown node type at $path: $type"; return; }
        if ($enforceRules && $parentType !== 'root' && $type !== 'root') {
            if (isset($allowed[$parentType]) && !isset($allowed[$parentType][$type])) {
                $errors[] = "Illegal child type: $parentType -> $type at $path";
            }
        }
        if ($type !== 'root') {
            $attrs = $node['attrs'] ?? [];
            if (!is_array($attrs)) { $errors[] = "attrs must be object at $path"; $attrs = []; }
            $def = $types[$type] ?? ['attributes' => []];
            $defs = $def['attributes'] ?? [];
            $attrDefs = [];
            foreach ($defs as $ad) {
                if (is_array($ad) && isset($ad['key'])) {
                    $attrDefs[$ad['key']] = $ad;
                }
            }
            foreach ($attrDefs as $k => $ad) {
                if (!empty($ad['required']) && !array_key_exists($k, $attrs)) {
                    $errors[] = "Missing required attribute '$k' at $path";
                }
            }
            foreach ($attrs as $k => $v) {
                if (isset($attrDefs[$k])) {
                    $t = $attrDefs[$k]['type'] ?? 'string';
                    if (!self::isType($v, $t)) {
                        $errors[] = "Attribute '$k' has wrong type at $path, expected $t";
                    }
                }
            }
        }
        $children = $node['children'] ?? [];
        if ($children !== null) {
            if (!is_array($children)) { $errors[] = "children must be array at $path"; return; }
            foreach ($children as $i => $child) {
                self::validateNode($child, $type, $types, $allowed, $enforceRules, $errors, $path . '.children[' . $i . ']');
            }
        }
    }

    private static function isType($v, string $t): bool
    {
        switch ($t) {
            case 'string': return is_string($v);
            case 'integer': return is_int($v);
            case 'number': return is_int($v) || is_float($v);
            case 'boolean': return is_bool($v);
            case 'date':
                if (!is_string($v)) return false;
                return (bool)preg_match('/^\d{4}-\d{2}-\d{2}/', $v);
            case 'json': return is_array($v) || is_object($v);
            default: return true;
        }
    }
}

?>