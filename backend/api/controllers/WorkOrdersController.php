<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';

class WorkOrdersController
{
    // Copy of robust auth used elsewhere
    private static function requireAuth(): array
    {
        global $env;

        $token = null;

        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            $token = $m[1];
        }
        if ($token === null && isset($_SERVER['HTTP_X_AUTH_TOKEN']) && $_SERVER['HTTP_X_AUTH_TOKEN'] !== '') {
            $token = $_SERVER['HTTP_X_AUTH_TOKEN'];
        }
        if ($token === null && isset($_GET['token']) && $_GET['token'] !== '') {
            $token = (string)$_GET['token'];
        }
        if ($token === null) {
            $input = self::json_input_safe();
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

    private static function json_input_safe(): array
    {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    // ===== Helpers for dynamic last-child machine reference =====

    private static function sanitizeIdent(string $raw): string
    {
        $id = strtolower(preg_replace('/[^a-zA-Z0-9_]+/', '_', $raw));
        $id = trim($id, '_');
        if ($id === '' || is_numeric($id[0] ?? '')) {
            $id = 'f_' . $id;
        }
        return $id;
    }

    private static function listColumns(PDO $pdo, string $table): array
    {
        $st = $pdo->prepare("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION");
        $st->execute([$table]);
        return array_map(fn($r) => $r['COLUMN_NAME'], $st->fetchAll());
    }

    private static function resolveCompanyTypeTable(PDO $pdo, int $companyId, string $typeKey): ?string
    {
        // Registry lookup
        $st = $pdo->prepare("SELECT table_name FROM company_table_registry WHERE company_id = ? AND type_key = ? LIMIT 1");
        $st->execute([$companyId, $typeKey]);
        $row = $st->fetch();
        if ($row && !empty($row['table_name'])) {
            return (string)$row['table_name'];
        }
        // Fallback to convention
        $table = 'c' . $companyId . '_' . self::sanitizeIdent($typeKey);
        $chk = $pdo->prepare("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1");
        $chk->execute([$table]);
        return $chk->fetchColumn() ? $table : null;
    }

    private static function loadStructure(PDO $pdo, int $companyId): ?array
    {
        $st = $pdo->prepare("SELECT structure_json FROM machine_structures WHERE company_id = ? LIMIT 1");
        $st->execute([$companyId]);
        $row = $st->fetch();
        if (!$row) return null;
        $s = json_decode($row['structure_json'], true);
        return is_array($s) ? $s : null;
    }

    private static function deepestTypeKeyFromTree(array $s): ?string
    {
        $tree = $s['tree'] ?? null;
        if (!is_array($tree)) return null;
        $maxDepth = -1;
        $deepType = null;
        $stack = [[$tree, 0]];
        while ($stack) {
            [$node, $depth] = array_pop($stack);
            $type = $node['type'] ?? null;
            $children = $node['children'] ?? null;
            $isLeaf = !is_array($children) || count($children) === 0;
            if ($type && $type !== 'root' && $isLeaf && $depth >= $maxDepth) {
                $maxDepth = $depth;
                $deepType = $type;
            }
            if (is_array($children)) {
                foreach ($children as $ch) {
                    if (is_array($ch)) $stack[] = [$ch, $depth + 1];
                }
            }
        }
        // Fallback: derive from rules (child types not used as parents)
        if ($deepType === null) {
            $parents = [];
            $children = [];
            foreach (($s['rules'] ?? []) as $r) {
                if (!empty($r['parent'])) $parents[$r['parent']] = true;
                if (!empty($r['child'])) $children[$r['child']] = true;
            }
            foreach ($children as $t => $_) {
                if (!isset($parents[$t])) {
                    $deepType = $t;
                    break;
                }
            }
        }
        return $deepType;
    }

    private static function determineCompanyLastChildAndDisplayCol(PDO $pdo, int $companyId): array
    {
        $structure = self::loadStructure($pdo, $companyId);
        if (!$structure) return [null, null];
        $typeKey = self::deepestTypeKeyFromTree($structure);
        if (!$typeKey) return [null, null];
        $table = self::resolveCompanyTypeTable($pdo, $companyId, $typeKey);
        if (!$table) return [$typeKey, null];
        $cols = self::listColumns($pdo, $table);
        $display = null;
        foreach (['name', 'title', 'label'] as $pref) {
            if (in_array($pref, $cols, true)) { $display = $pref; break; }
        }
        if ($display === null) {
            foreach ($cols as $col) {
                if (in_array($col, ['id','created_at','updated_at','created_by','updated_by'], true)) continue;
                $display = $col;
                break;
            }
        }
        return [$typeKey, $display];
    }

    // GET /workorders?companyId=&q=&taskId=&status=&priority=&assignedTo=&limit=&offset=
    public static function list(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $isSuper = self::isSuperadmin($claims);
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam === null || $companyIdParam === '')
            ? ($isSuper ? null : ($claims['company_id'] ?? null))
            : (int)$companyIdParam;

        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $taskId = isset($_GET['taskId']) ? (int)$_GET['taskId'] : 0;
        $status = isset($_GET['status']) ? trim((string)$_GET['status']) : '';
        $priority = isset($_GET['priority']) ? trim((string)$_GET['priority']) : '';
        $assignedTo = isset($_GET['assignedTo']) && $_GET['assignedTo'] !== '' ? (int)$_GET['assignedTo'] : null;

        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;

        $where = [];
        $params = [];
        if ($companyId !== null) { $where[] = '(wo.company_id = ?)'; $params[] = $companyId; }
        if ($q !== '') { $where[] = '(wo.title LIKE ? OR wo.description LIKE ?)'; $like = '%' . $q . '%'; $params[] = $like; $params[] = $like; }
        if ($taskId > 0) { $where[] = '(wo.task_id = ?)'; $params[] = $taskId; }
        if ($status !== '') { $where[] = '(wo.status = ?)'; $params[] = $status; }
        if ($priority !== '') { $where[] = '(wo.priority = ?)'; $params[] = $priority; }
        if ($assignedTo !== null) { $where[] = '(wo.assigned_to = ?)'; $params[] = $assignedTo; }

        $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

        $sql = "SELECT
                    wo.id,
                    wo.company_id AS companyId,
                    wo.task_id AS taskId,
                    wo.machine_id AS machineId,
                    wo.machine_type_key AS machineTypeKey,
                    wo.machine_row_id AS machineRowId,
                    wo.machine_name AS machineName,
                    wo.title,
                    wo.description,
                    wo.status,
                    wo.priority,
                    wo.assigned_to AS assignedTo,
                    wo.due_date AS dueDate,
                    wo.was_shutdown AS wasShutdown,
                    wo.shutdown_start AS shutdownStart,
                    wo.shutdown_end AS shutdownEnd,
                    wo.started_at AS startedAt,
                    wo.completed_at AS completedAt,
                    wo.created_by AS createdBy,
                    wo.created_at AS createdAt,
                    wo.updated_at AS updatedAt,
                    t.title AS taskTitle
                FROM work_orders wo
                LEFT JOIN tasks t ON t.id = wo.task_id
                $whereSql
                ORDER BY wo.created_at DESC
                LIMIT $limit OFFSET $offset";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        json_response(['items' => $rows, 'limit' => $limit, 'offset' => $offset]);
    }

    // GET /workorders/{id}
    public static function get(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $stmt = $pdo->prepare("SELECT
                                wo.id,
                                wo.company_id AS companyId,
                                wo.task_id AS taskId,
                                wo.machine_id AS machineId,
                                wo.machine_type_key AS machineTypeKey,
                                wo.machine_row_id AS machineRowId,
                                wo.machine_name AS machineName,
                                wo.title,
                                wo.description,
                                wo.status,
                                wo.priority,
                                wo.assigned_to AS assignedTo,
                                wo.due_date AS dueDate,
                                wo.was_shutdown AS wasShutdown,
                                wo.shutdown_start AS shutdownStart,
                                wo.shutdown_end AS shutdownEnd,
                                wo.started_at AS startedAt,
                                wo.completed_at AS completedAt,
                                wo.created_by AS createdBy,
                                wo.created_at AS createdAt,
                                wo.updated_at AS updatedAt
                               FROM work_orders wo
                               WHERE wo.id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { json_response(['error' => 'Not found'], 404); }

        if (!self::isSuperadmin($claims)) {
            $cid = $row['companyId'] !== null ? (int)$row['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        json_response($row);
    }

    // POST /workorders
    public static function create(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $input = self::json_input_safe();
        $title = trim($input['title'] ?? '');
        $taskId = isset($input['taskId']) ? (int)$input['taskId'] : 0;
        $description = trim($input['description'] ?? '');
        $status = trim($input['status'] ?? 'open');
        $priority = trim($input['priority'] ?? 'medium');
        $assignedTo = isset($input['assignedTo']) && $input['assignedTo'] !== '' ? (int)$input['assignedTo'] : null;
        $dueDate = isset($input['dueDate']) && $input['dueDate'] !== '' ? $input['dueDate'] : null;

        // New optional fields (legacy)
        $machineId = isset($input['machineId']) && $input['machineId'] !== '' ? (int)$input['machineId'] : null;
        $wasShutdown = !empty($input['wasShutdown']) ? 1 : 0;
        $shutdownStart = isset($input['shutdownStart']) && $input['shutdownStart'] !== '' ? (string)$input['shutdownStart'] : null;
        $shutdownEnd = isset($input['shutdownEnd']) && $input['shutdownEnd'] !== '' ? (string)$input['shutdownEnd'] : null;
        if ($shutdownStart !== null) { $shutdownStart = str_replace('T', ' ', $shutdownStart); }
        if ($shutdownEnd !== null) { $shutdownEnd = str_replace('T', ' ', $shutdownEnd); }

        // Dynamic last-child machine reference
        $machineTypeKey = isset($input['machineTypeKey']) ? trim((string)$input['machineTypeKey']) : null;
        $machineRowId = isset($input['machineRowId']) && $input['machineRowId'] !== '' ? (int)$input['machineRowId'] : null;
        $machineName = isset($input['machineName']) ? trim((string)$input['machineName']) : null;

        if ($title === '') {
            json_response(['error' => 'title is required'], 400);
        }
        if (!in_array($status, ['open','assigned','in_progress','on_hold','completed','cancelled'])) {
            json_response(['error' => 'Invalid status'], 400);
        }
        if (!in_array($priority, ['low','medium','high'])) {
            json_response(['error' => 'Invalid priority'], 400);
        }

        $createdBy = (int)($claims['sub'] ?? 0);

        // Company scoping: infer from task or from claims
        $companyId = null;
        if (self::isSuperadmin($claims)) {
            $companyId = isset($input['companyId']) ? (int)$input['companyId'] : null;
        } else {
            $companyId = $claims['company_id'] ?? null;
            if ($companyId === null) {
                json_response(['error' => 'Company scope required'], 400);
            }
        }

        // Validate task exists and (if scoped) belongs to same company
        $st = $pdo->prepare('SELECT id, company_id AS companyId FROM tasks WHERE id = ?');
        $st->execute([$taskId]);
        $task = $st->fetch();
        //if (!$task) { json_response(['error' => 'Task not found'], 404); }
        if (!self::isSuperadmin($claims)) {
            $tCompanyId = $task['companyId'] !== null ? (int)$task['companyId'] : null;
            if ($tCompanyId !== ($claims['company_id'] ?? null)) {
                json_response(['error' => 'Task belongs to another company'], 403);
            }
        }

        // If machine provided, validate it and enforce company scope (legacy assets linkage)
        if ($machineId !== null) {
            $sm = $pdo->prepare('SELECT id, company_id AS companyId FROM assets WHERE id = ?');
            $sm->execute([$machineId]);
            $asset = $sm->fetch();
            if (!$asset) { json_response(['error' => 'Machine not found'], 404); }
            if (!self::isSuperadmin($claims)) {
                $aCompanyId = $asset['companyId'] !== null ? (int)$asset['companyId'] : null;
                if ($aCompanyId !== ($claims['company_id'] ?? null)) {
                    json_response(['error' => 'Machine belongs to another company'], 403);
                }
            }
            if ($companyId === null) {
                $companyId = $asset['companyId'] ?? null;
            }
        }

        // Validate dynamic last-child selection if provided; auto-fill if name missing
        if ($machineRowId !== null || ($machineTypeKey !== null && $machineTypeKey !== '')) {
            if ($companyId === null) {
                json_response(['error' => 'Company scope required for machine reference'], 400);
            }
            [$deepTypeKey, $displayCol] = self::determineCompanyLastChildAndDisplayCol($pdo, (int)$companyId);
            if (!$deepTypeKey) {
                json_response(['error' => 'Company machine structure not configured'], 400);
            }
            if ($machineTypeKey === null || $machineTypeKey === '') {
                $machineTypeKey = $deepTypeKey;
            } elseif (strtolower((string)$machineTypeKey) !== strtolower((string)$deepTypeKey)) {
                json_response(['error' => 'machineTypeKey must match the company\'s last-level type', 'expected' => $deepTypeKey], 422);
            }
            if ($machineRowId === null) {
                json_response(['error' => 'machineRowId is required when machineTypeKey is provided'], 422);
            }
            $table = self::resolveCompanyTypeTable($pdo, (int)$companyId, $deepTypeKey);
            if (!$table) {
                json_response(['error' => 'Resolved machine table not found for type'], 404);
            }
            $cols = self::listColumns($pdo, $table);
            $disp = $displayCol ?? (in_array('name',$cols,true) ? 'name' : (in_array('title',$cols,true) ? 'title' : 'id'));
            $stn = $pdo->prepare("SELECT `$disp` AS val FROM `$table` WHERE id = ? LIMIT 1");
            $stn->execute([$machineRowId]);
            $rown = $stn->fetch();
            if (!$rown) {
                json_response(['error' => 'Machine record not found in company last-level table'], 404);
            }
            if ($machineName === null || $machineName === '') {
                $machineName = (string)$rown['val'];
            }
        }

        try {
            $stmt = $pdo->prepare('INSERT INTO work_orders
                (company_id, task_id, machine_id, machine_type_key, machine_row_id, machine_name, title, description, was_shutdown, shutdown_start, shutdown_end, status, priority, assigned_to, due_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([
                $companyId,
                $taskId,
                $machineId,
                $machineTypeKey,
                $machineRowId,
                $machineName,
                $title,
                $description,
                $wasShutdown,
                $shutdownStart,
                $shutdownEnd,
                $status,
                $priority,
                $assignedTo,
                $dueDate,
                $createdBy
            ]);
            $id = (int)$pdo->lastInsertId();
            json_response(['message' => 'Work order created', 'id' => $id], 201);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to create work order', 'detail' => $e->getMessage()], 500);
        }
    }

    // PUT /workorders/{id}
    public static function update(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM work_orders WHERE id = ?');
        $stmt->execute([$id]);
        $wo = $stmt->fetch();
        if (!$wo) { json_response(['error' => 'Not found'], 404); }

        if (!self::isSuperadmin($claims)) {
            $cid = $wo['companyId'] !== null ? (int)$wo['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        $input = self::json_input_safe();
        $fields = [];
        $params = [];

        if (isset($input['title'])) { $fields[] = 'title = ?'; $params[] = trim((string)$input['title']); }
        if (array_key_exists('description', $input)) { $fields[] = 'description = ?'; $params[] = (string)$input['description']; }
        if (isset($input['status'])) {
            $st = trim((string)$input['status']);
            if (!in_array($st, ['open','assigned','in_progress','on_hold','completed','cancelled'])) { json_response(['error' => 'Invalid status'], 400); }
            $fields[] = 'status = ?'; $params[] = $st;
        }
        if (isset($input['priority'])) {
            $pr = trim((string)$input['priority']);
            if (!in_array($pr, ['low','medium','high'])) { json_response(['error' => 'Invalid priority'], 400); }
            $fields[] = 'priority = ?'; $params[] = $pr;
        }
        if (array_key_exists('assignedTo', $input)) {
            $fields[] = 'assigned_to = ?'; $params[] = ($input['assignedTo'] !== '' ? (int)$input['assignedTo'] : null);
        }
        if (array_key_exists('machineId', $input)) {
            $fields[] = 'machine_id = ?'; $params[] = ($input['machineId'] !== '' ? (int)$input['machineId'] : null);
        }
        if (array_key_exists('machineTypeKey', $input)) {
            $fields[] = 'machine_type_key = ?'; $params[] = ($input['machineTypeKey'] !== '' ? (string)$input['machineTypeKey'] : null);
        }
        if (array_key_exists('machineRowId', $input)) {
            $fields[] = 'machine_row_id = ?'; $params[] = ($input['machineRowId'] !== '' ? (int)$input['machineRowId'] : null);
        }
        if (array_key_exists('machineName', $input)) {
            $fields[] = 'machine_name = ?'; $params[] = ($input['machineName'] !== '' ? (string)$input['machineName'] : null);
        }
        if (array_key_exists('wasShutdown', $input)) {
            $fields[] = 'was_shutdown = ?'; $params[] = (!empty($input['wasShutdown']) ? 1 : 0);
        }
        if (array_key_exists('shutdownStart', $input)) {
            $fields[] = 'shutdown_start = ?';
            $params[] = ($input['shutdownStart'] !== '' ? str_replace('T',' ', (string)$input['shutdownStart']) : null);
        }
        if (array_key_exists('shutdownEnd', $input)) {
            $fields[] = 'shutdown_end = ?';
            $params[] = ($input['shutdownEnd'] !== '' ? str_replace('T',' ', (string)$input['shutdownEnd']) : null);
        }
        if (array_key_exists('dueDate', $input)) { $fields[] = 'due_date = ?'; $params[] = ($input['dueDate'] !== '' ? $input['dueDate'] : null); }
        if (array_key_exists('startedAt', $input)) { $fields[] = 'started_at = ?'; $params[] = ($input['startedAt'] !== '' ? $input['startedAt'] : null); }
        if (array_key_exists('completedAt', $input)) { $fields[] = 'completed_at = ?'; $params[] = ($input['completedAt'] !== '' ? $input['completedAt'] : null); }

        if (empty($fields)) {
            json_response(['message' => 'No changes'], 200);
        }

        $params[] = $id;
        $sql = 'UPDATE work_orders SET ' . implode(', ', $fields) . ' WHERE id = ?';
        try {
            $pdo->prepare($sql)->execute($params);
            json_response(['message' => 'Work order updated']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to update work order'], 500);
        }
    }

    // DELETE /workorders/{id}
    public static function delete(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM work_orders WHERE id = ?');
        $stmt->execute([$id]);
        $wo = $stmt->fetch();
        if (!$wo) { json_response(['error' => 'Not found'], 404); }

        if (!self::isSuperadmin($claims)) {
            $cid = $wo['companyId'] !== null ? (int)$wo['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        try {
            $pdo->prepare('DELETE FROM work_orders WHERE id = ?')->execute([$id]);
            json_response(['message' => 'Work order deleted']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to delete work order'], 500);
        }
    }

    // GET /workorders/machines?companyId=&limit=&q=
    public static function machines(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $isSuper = self::isSuperadmin($claims);
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam !== null && $companyIdParam !== '')
            ? (int)$companyIdParam
            : ($isSuper ? null : (int)($claims['company_id'] ?? 0));

        if ($companyId === null || $companyId === 0) {
            json_response(['error' => 'companyId is required for superadmin'], 400);
        }

        [$typeKey, $displayCol] = self::determineCompanyLastChildAndDisplayCol($pdo, (int)$companyId);
        if (!$typeKey) {
            json_response(['typeKey' => null, 'items' => []]);
        }

        $table = self::resolveCompanyTypeTable($pdo, (int)$companyId, $typeKey);
        if (!$table) {
            json_response(['typeKey' => $typeKey, 'items' => []]);
        }

        $cols = self::listColumns($pdo, $table);
        $disp = $displayCol ?? (in_array('name', $cols, true) ? 'name' : (in_array('title', $cols, true) ? 'title' : 'id'));

        $limit = isset($_GET['limit']) ? max(1, min(500, (int)$_GET['limit'])) : 200;
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $params = [];
        $sql = "SELECT `id`, `$disp` AS `name` FROM `$table`";
        if ($q !== '' && $disp !== 'id') {
            $sql .= " WHERE `$disp` LIKE ?";
            $params[] = '%' . $q . '%';
        }
        $sql .= " ORDER BY `$disp` LIMIT $limit";
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $items = $st->fetchAll();

        json_response(['typeKey' => $typeKey, 'items' => $items]);
    }

    // GET /workorders/stats?companyId=&taskId=
    public static function stats(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $isSuper = self::isSuperadmin($claims);
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam === null || $companyIdParam === '')
            ? ($isSuper ? null : ($claims['company_id'] ?? null))
            : (int)$companyIdParam;

        $taskId = isset($_GET['taskId']) ? (int)$_GET['taskId'] : 0;

        $where = [];
        $params = [];
        if ($companyId !== null) { $where[] = 'company_id = ?'; $params[] = $companyId; }
        if ($taskId > 0) { $where[] = 'task_id = ?'; $params[] = $taskId; }
        $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

        $out = [
            'total' => 0,
            'open' => 0,
            'assigned' => 0,
            'in_progress' => 0,
            'on_hold' => 0,
            'completed' => 0,
            'cancelled' => 0,
            'high' => 0,
            'medium' => 0,
            'low' => 0
        ];

        $stmt = $pdo->prepare("SELECT COUNT(*) FROM work_orders $whereSql");
        $stmt->execute($params);
        $out['total'] = (int)$stmt->fetchColumn();

        foreach (['open','assigned','in_progress','on_hold','completed','cancelled'] as $st) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM work_orders $whereSql" . (strlen($whereSql) ? " AND" : " WHERE") . " status = ?");
            $stmt->execute(array_merge($params, [$st]));
            $out[$st] = (int)$stmt->fetchColumn();
        }

        foreach (['high','medium','low'] as $p) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM work_orders $whereSql" . (strlen($whereSql) ? " AND" : " WHERE") . " priority = ?");
            $stmt->execute(array_merge($params, [$p]));
            $out[$p] = (int)$stmt->fetchColumn();
        }

        json_response($out);
    }
}