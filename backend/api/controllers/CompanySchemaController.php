<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';
require_once __DIR__ . '/../lib/Permissions.php';

class CompanySchemaController
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

    // ----- Public endpoints -----

    // POST /companies/{id}/schema/apply
    public static function apply(int $companyId): void
    {
        $claims = self::requireAuth();
        self::requireCompanyManage($claims);
        $userId = self::getUserId($claims);

        $pdo = db();
        // Ensure company exists
        $stmt = $pdo->prepare('SELECT id, name FROM companies WHERE id = ?');
        $stmt->execute([$companyId]);
        $company = $stmt->fetch();
        if (!$company) {
            json_response(['error' => 'Company not found'], 404);
        }

        // Fetch structure JSON for company
        $stmt = $pdo->prepare('SELECT structure_json, version FROM machine_structures WHERE company_id = ?');
        $stmt->execute([$companyId]);
        $row = $stmt->fetch();
        if (!$row) {
            json_response(['error' => 'No structure saved for this company'], 400);
        }
        $structure = json_decode($row['structure_json'], true);
        if (!is_array($structure)) {
            json_response(['error' => 'Invalid structure JSON'], 400);
        }

        $input = json_input();
        $breaking = !empty($input['breaking']);

        // Compute DDL plan
        $plan = self::computeDDLPlan($pdo, $companyId, $structure, $breaking);

        // Execute plan in a transaction
        $errors = [];
        $executed = [];
        try {
            $pdo->beginTransaction();
            foreach ($plan['sql'] as $sql) {
                $pdo->exec($sql);
                $executed[] = $sql;
            }

            // Upsert table registry
            foreach ($plan['registry'] as $typeKey => $tableName) {
                if (!self::registryHas($pdo, $companyId, $typeKey)) {
                    $ins = $pdo->prepare('INSERT INTO company_table_registry (company_id, type_key, table_name) VALUES (?, ?, ?)');
                    $ins->execute([$companyId, $typeKey, $tableName]);
                } else {
                    $upd = $pdo->prepare('UPDATE company_table_registry SET table_name = ? WHERE company_id = ? AND type_key = ?');
                    $upd->execute([$tableName, $companyId, $typeKey]);
                }
            }

            // Bump version
            $ver = self::nextSchemaVersion($pdo, $companyId);
            $insVer = $pdo->prepare('INSERT INTO company_schema_versions (company_id, version, breaking, summary_json) VALUES (?, ?, ?, ?)');
            $insVer->execute([$companyId, $ver, $breaking ? 1 : 0, json_encode($plan, JSON_UNESCAPED_UNICODE)]);

            $pdo->commit();
        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
            if ($pdo->inTransaction()) $pdo->rollBack();
        }

        if (!empty($errors)) {
            json_response(['error' => 'Apply failed', 'errors' => $errors, 'executed' => $executed], 500);
        }
        json_response([
            'message' => 'Schema applied',
            'company_id' => $companyId,
            'version' => self::currentSchemaVersion($pdo, $companyId),
            'executed' => $executed,
            'notes' => $plan['notes'],
        ]);
    }

    // ----- Planner / inspector helpers -----

    private static function nextSchemaVersion(PDO $pdo, int $companyId): int
    {
        $stmt = $pdo->prepare('SELECT MAX(version) AS v FROM company_schema_versions WHERE company_id = ?');
        $stmt->execute([$companyId]);
        $v = (int)($stmt->fetch()['v'] ?? 0);
        return $v + 1;
    }

    private static function currentSchemaVersion(PDO $pdo, int $companyId): int
    {
        $stmt = $pdo->prepare('SELECT MAX(version) AS v FROM company_schema_versions WHERE company_id = ?');
        $stmt->execute([$companyId]);
        return (int)($stmt->fetch()['v'] ?? 0);
    }

    private static function registryHas(PDO $pdo, int $companyId, string $typeKey): bool
    {
        $st = $pdo->prepare('SELECT 1 FROM company_table_registry WHERE company_id = ? AND type_key = ?');
        $st->execute([$companyId, $typeKey]);
        return (bool)$st->fetchColumn();
    }

    private static function computeDDLPlan(PDO $pdo, int $companyId, array $s, bool $breaking): array
    {
        // 0) Gather type definitions
        $types = [];
        foreach (($s['nodeTypes'] ?? []) as $nt) {
            if (is_array($nt) && isset($nt['key'])) {
                $types[$nt['key']] = $nt;
            }
        }

        // 1) Build child->parent mapping (first parent wins).
        //    Combine explicit rules with relationships derived from the current tree usage.
        $childParent = [];
        $multiParent = [];
        // From rules
        foreach (($s['rules'] ?? []) as $r) {
            $p = $r['parent'] ?? null;
            $c = $r['child'] ?? null;
            if (!$p || !$c) continue;
            if (!isset($childParent[$c])) {
                $childParent[$c] = $p;
            } elseif ($childParent[$c] !== $p) {
                $multiParent[$c] = true; // multiple different parents detected
            }
        }
        // From tree (ordering): ensures e.g. machine -> line yields machine_id on line
        [$treeCP, $treeMP] = self::deriveChildParentFromTree($s);
        foreach ($treeCP as $c => $p) {
            if (!isset($childParent[$c])) {
                $childParent[$c] = $p;
            } elseif ($childParent[$c] !== $p) {
                $multiParent[$c] = true;
            }
        }
        foreach ($treeMP as $c => $_) {
            $multiParent[$c] = true;
        }

        // 2) Compute actually used node types from the saved tree to avoid creating tables
        //    for unused defaults. This makes the physical schema reflect the real structure.
        $used = [];
        $walk = function ($node) use (&$walk, &$used) {
            if (!is_array($node)) return;
            $t = $node['type'] ?? null;
            if (is_string($t) && $t !== 'root') {
                $used[$t] = true;
            }
            $children = $node['children'] ?? null;
            if (is_array($children)) {
                foreach ($children as $ch) {
                    $walk($ch);
                }
            }
        };
        $walk($s['tree'] ?? null);

        $sql = [];
        $registry = [];
        $notes = [];

        // 3) For each used type only, ensure table + columns + constraints
        foreach ($types as $key => $def) {
            if (!isset($used[$key])) {
                // Skip types that are not present anywhere in the current tree
                continue;
            }

            $table = self::tableName($companyId, $key);
            $registry[$key] = $table;

            // 3.1) Ensure table exists
            if (!self::tableExists($pdo, $table)) {
                $sql[] = self::createTableSQL($table);
            }

            // 3.2) Ensure parent FK (single parent only)
            $hasMulti = isset($multiParent[$key]);
            if ($hasMulti) {
                $notes[] = "Type '$key' has multiple parents; FK not generated. Consider a join table.";
            } else {
                $parent = $childParent[$key] ?? null;
                if ($parent) {
                    $parentTable = self::tableName($companyId, $parent);
                    if (!self::tableExists($pdo, $parentTable)) {
                        $sql[] = self::createTableSQL($parentTable);
                    }
                    // parent column
                    $parentCol = self::parentColumnName($parent);
                    if (!self::columnExists($pdo, $table, $parentCol)) {
                        // Make parent column nullable to allow top-level rows when needed
                        $sql[] = "ALTER TABLE `$table` ADD COLUMN `$parentCol` INT NULL";
                        $sql[] = "CREATE INDEX `idx_{$table}_{$parentCol}` ON `$table` (`$parentCol`)";
                    } else {
                        // If it already exists but is NOT NULL from a previous apply, relax to NULL
                        if (!self::columnIsNullable($pdo, $table, $parentCol)) {
                            $sql[] = "ALTER TABLE `$table` MODIFY `$parentCol` INT NULL";
                        }
                    }
                    // FK
                    $fkName = "fk_{$table}_{$parentCol}";
                    if (!self::foreignKeyExists($pdo, $table, $fkName)) {
                        $sql[] = "ALTER TABLE `$table` ADD CONSTRAINT `$fkName` FOREIGN KEY (`$parentCol`) REFERENCES `$parentTable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE";
                    }
                }
            }

            // 3.3) Ensure attribute columns
            $attrs = $def['attributes'] ?? [];
            $hasName = false;
            foreach ($attrs as $a) {
                $col = self::sanitizeIdent($a['key'] ?? '');
                if ($col === '') continue;
                $type = self::sqlType($a);
                $required = !empty($a['required']);
                $nullClause = $required ? 'NOT NULL' : 'NULL';
                if (!self::columnExists($pdo, $table, $col)) {
                    $sql[] = "ALTER TABLE `$table` ADD COLUMN `$col` $type $nullClause";
                }
                if ($col === 'name') { $hasName = true; }
            }

            // 3.4) Default uniqueness indexes
            if ($hasName) {
                $parent = $childParent[$key] ?? null;
                if ($parent && !isset($multiParent[$key])) {
                    $parentCol = self::parentColumnName($parent);
                    $uq = "uq_{$table}_{$parentCol}_name";
                    if (!self::indexExists($pdo, $table, $uq)) {
                        $sql[] = "ALTER TABLE `$table` ADD CONSTRAINT `$uq` UNIQUE (`$parentCol`, `name`)";
                    }
                } else {
                    $uq = "uq_{$table}_name";
                    if (!self::indexExists($pdo, $table, $uq)) {
                        $sql[] = "ALTER TABLE `$table` ADD CONSTRAINT `$uq` UNIQUE (`name`)";
                    }
                }
            }
        }

        return ['sql' => $sql, 'registry' => $registry, 'notes' => $notes];
    }

    // ----- Introspection helpers -----

    private static function tableName(int $companyId, string $typeKey): string
    {
        return 'c' . $companyId . '_' . self::sanitizeIdent($typeKey);
    }

    private static function parentColumnName(string $parentType): string
    {
        return self::sanitizeIdent($parentType) . '_id';
    }

    private static function sanitizeIdent(string $raw): string
    {
        $id = strtolower(preg_replace('/[^a-zA-Z0-9_]+/', '_', $raw));
        $id = trim($id, '_');
        if ($id === '' || is_numeric($id[0])) {
            $id = 'f_' . $id;
        }
        return $id;
    }

    private static function sqlType(array $attr): string
    {
        $t = strtolower((string)($attr['type'] ?? 'string'));
        switch ($t) {
            case 'integer': return 'INT';
            case 'number': return 'DECIMAL(18,4)';
            case 'boolean': return 'TINYINT(1)';
            case 'date': return 'DATETIME';
            case 'json': return 'JSON';
            case 'enum':
                $vals = $attr['values'] ?? [];
                $clean = array_map(function ($v) {
                    $v = (string)$v;
                    $v = str_replace("'", "''", $v);
                    return "'" . $v . "'";
                }, $vals);
                return count($clean) ? 'ENUM(' . implode(',', $clean) . ')' : 'VARCHAR(255)';
            case 'string':
            default:
                return 'VARCHAR(255)';
        }
    }

    private static function createTableSQL(string $table): string
    {
        return "CREATE TABLE IF NOT EXISTS `$table` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `created_by` INT NULL,
  `updated_by` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    }

    private static function tableExists(PDO $pdo, string $table): bool
    {
        $stmt = $pdo->prepare("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1");
        $stmt->execute([$table]);
        return (bool)$stmt->fetchColumn();
    }

    private static function columnExists(PDO $pdo, string $table, string $col): bool
    {
        $stmt = $pdo->prepare("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1");
        $stmt->execute([$table, $col]);
        return (bool)$stmt->fetchColumn();
    }

    private static function indexExists(PDO $pdo, string $table, string $indexName): bool
    {
        $stmt = $pdo->prepare("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1");
        $stmt->execute([$table, $indexName]);
        return (bool)$stmt->fetchColumn();
    }

    private static function foreignKeyExists(PDO $pdo, string $table, string $constraint): bool
    {
        $stmt = $pdo->prepare("SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1");
        $stmt->execute([$table, $constraint]);
        return (bool)$stmt->fetchColumn();
    }

    private static function columnIsNullable(PDO $pdo, string $table, string $col): bool
    {
        $stmt = $pdo->prepare("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1");
        $stmt->execute([$table, $col]);
        $v = $stmt->fetchColumn();
        return strtoupper((string)$v) === 'YES';
    }

    /**
     * Derive child->parent relationships from the current saved tree.
     * Any edge parent_type -> child_type (excluding 'root' and same-type) is captured.
     * Returns [childParentMap, multiParentSet]
     */
    private static function deriveChildParentFromTree(array $s): array
    {
        $childParent = [];
        $multiParent = [];

        $walk = function ($node) use (&$walk, &$childParent, &$multiParent) {
            if (!is_array($node)) return;
            $parentType = $node['type'] ?? null;
            $children = $node['children'] ?? null;
            if (!is_array($children)) return;
            foreach ($children as $ch) {
                if (!is_array($ch)) continue;
                $childType = $ch['type'] ?? null;
                if ($parentType && $childType && $parentType !== 'root' && $childType !== 'root' && $parentType !== $childType) {
                    if (!isset($childParent[$childType])) {
                        $childParent[$childType] = $parentType;
                    } elseif ($childParent[$childType] !== $parentType) {
                        $multiParent[$childType] = true;
                    }
                }
                $walk($ch);
            }
        };

        $walk($s['tree'] ?? null);
        return [$childParent, $multiParent];
    }
}
 
?>