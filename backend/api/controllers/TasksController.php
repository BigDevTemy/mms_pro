<?php

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/Jwt.php';

class TasksController
{
    // Lightweight copy of AdminController::requireAuth() to keep controllers decoupled
    private static function requireAuth(): array
    {
        global $env;

        $token = null;

        // Authorization: Bearer <token>
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            $token = $m[1];
        }
        // X-Auth-Token
        if ($token === null && isset($_SERVER['HTTP_X_AUTH_TOKEN']) && $_SERVER['HTTP_X_AUTH_TOKEN'] !== '') {
            $token = $_SERVER['HTTP_X_AUTH_TOKEN'];
        }
        // token in query
        if ($token === null && isset($_GET['token']) && $_GET['token'] !== '') {
            $token = (string)$_GET['token'];
        }
        // token in JSON body
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

    // GET /tasks?companyId=&q=&category=&frequency=&status=&limit=&offset=
    public static function list(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $isSuper = self::isSuperadmin($claims);
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam === null || $companyIdParam === '')
            ? ($isSuper ? null : ($claims['company_id'] ?? null))
            : (int)$companyIdParam;

        // Filters
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $category = isset($_GET['category']) ? trim((string)$_GET['category']) : '';
        $frequency = isset($_GET['frequency']) ? trim((string)$_GET['frequency']) : '';
        $status = isset($_GET['status']) ? trim((string)$_GET['status']) : '';
        $maintType = isset($_GET['maintType']) ? trim((string)$_GET['maintType']) : '';

        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 50;
        $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;

        $where = [];
        $params = [];

        if ($companyId !== null) { $where[] = '(t.company_id = ?)'; $params[] = $companyId; }
        if ($q !== '') { $where[] = '(t.title LIKE ? OR t.description LIKE ?)'; $like = '%' . $q . '%'; $params[] = $like; $params[] = $like; }
        if ($category !== '') { $where[] = '(t.category = ?)'; $params[] = $category; }
        if ($frequency !== '') { $where[] = '(t.frequency = ?)'; $params[] = $frequency; }
        if ($status !== '') { $where[] = '(t.status = ?)'; $params[] = $status; }
        if ($maintType !== '') { $where[] = '(t.maint_type = ?)'; $params[] = $maintType; }

        $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

        $sql = "SELECT
                    t.id, t.company_id AS companyId, t.title, t.category, t.frequency,
                    t.maint_type AS maintType,
                    t.description, t.status, t.priority, t.due_date AS dueDate,
                    t.created_by AS createdBy, t.created_at AS createdAt, t.updated_at AS updatedAt,
                    c.name AS companyName
                FROM tasks t
                LEFT JOIN companies c ON c.id = t.company_id
                $whereSql
                ORDER BY t.created_at DESC
                LIMIT $limit OFFSET $offset";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        json_response(['items' => $rows, 'limit' => $limit, 'offset' => $offset]);
    }

    // GET /tasks/{id}
    public static function get(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $stmt = $pdo->prepare("SELECT
                                t.id, t.company_id AS companyId, t.title, t.category, t.frequency,
                                t.maint_type AS maintType,
                                t.description, t.status, t.priority, t.due_date AS dueDate,
                                t.created_by AS createdBy, t.created_at AS createdAt, t.updated_at AS updatedAt
                               FROM tasks t WHERE t.id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { json_response(['error' => 'Not found'], 404); }

        // If not superadmin, must match user company
        if (!self::isSuperadmin($claims)) {
            $cid = $row['companyId'] !== null ? (int)$row['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        json_response($row);
    }

    // POST /tasks
    public static function create(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $input = self::json_input_safe();
        $title = trim($input['title'] ?? '');
        $category = trim($input['category'] ?? '');
        $frequency = trim($input['frequency'] ?? '');
        $maintType = trim($input['maintType'] ?? 'Preventive');
        $description = trim($input['description'] ?? '');
        $priority = trim($input['priority'] ?? 'medium');
        $dueDate = isset($input['dueDate']) && $input['dueDate'] !== '' ? $input['dueDate'] : null;

        $companyIdInput = isset($input['companyId']) ? (int)$input['companyId'] : null;

        if ($title === '' || $category === '' || $frequency === '') {
            json_response(['error' => 'title, category, frequency are required'], 400);
        }
        if (!in_array($category, ['Electrical','Mechanical'])) {
            json_response(['error' => 'Invalid category'], 400);
        }
        if (!in_array($frequency, ['daily','weekly','monthly','yearly'])) {
            json_response(['error' => 'Invalid frequency'], 400);
        }
        if (!in_array($maintType, ['Preventive','Corrective','Predictive','Inspection'])) {
            json_response(['error' => 'Invalid maintType'], 400);
        }
        if (!in_array($priority, ['low','medium','high'])) {
            json_response(['error' => 'Invalid priority'], 400);
        }

        $createdBy = (int)($claims['sub'] ?? 0);

        // Company scoping: superadmin may set companyId, non-superadmin uses their company_id
        if (self::isSuperadmin($claims)) {
            $companyId = $companyIdInput;
        } else {
            $companyId = $claims['company_id'] ?? null;
            if ($companyId === null) {
                json_response(['error' => 'Company scope required'], 400);
            }
        }

        try {
            $stmt = $pdo->prepare('INSERT INTO tasks (company_id, title, category, frequency, maint_type, description, status, priority, due_date, created_by)
                                   VALUES (?, ?, ?, ?, ?, ?, "pending", ?, ?, ?)');
            $stmt->execute([$companyId, $title, $category, $frequency, $maintType, $description, $priority, $dueDate, $createdBy]);
            $id = (int)$pdo->lastInsertId();
            json_response(['message' => 'Task created', 'id' => $id], 201);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to create task'], 500);
        }
    }

    // PUT /tasks/{id} (update status/metadata)
    public static function update(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        // Load current
        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM tasks WHERE id = ?');
        $stmt->execute([$id]);
        $task = $stmt->fetch();
        if (!$task) { json_response(['error' => 'Not found'], 404); }

        if (!self::isSuperadmin($claims)) {
            $cid = $task['companyId'] !== null ? (int)$task['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        $input = self::json_input_safe();
        $fields = [];
        $params = [];

        if (isset($input['title'])) { $fields[] = 'title = ?'; $params[] = trim((string)$input['title']); }
        if (isset($input['category'])) {
            $cat = trim((string)$input['category']);
            if (!in_array($cat, ['Electrical','Mechanical'])) { json_response(['error' => 'Invalid category'], 400); }
            $fields[] = 'category = ?'; $params[] = $cat;
        }
        if (isset($input['frequency'])) {
            $freq = trim((string)$input['frequency']);
            if (!in_array($freq, ['daily','weekly','monthly','yearly'])) { json_response(['error' => 'Invalid frequency'], 400); }
            $fields[] = 'frequency = ?'; $params[] = $freq;
        }
        if (isset($input['status'])) {
            $st = trim((string)$input['status']);
            if (!in_array($st, ['pending','in_progress','completed'])) { json_response(['error' => 'Invalid status'], 400); }
            $fields[] = 'status = ?'; $params[] = $st;
        }
        if (isset($input['maintType'])) {
            $mt = trim((string)$input['maintType']);
            if (!in_array($mt, ['Preventive','Corrective','Predictive','Inspection'])) { json_response(['error' => 'Invalid maintType'], 400); }
            $fields[] = 'maint_type = ?'; $params[] = $mt;
        }
        if (isset($input['priority'])) {
            $pr = trim((string)$input['priority']);
            if (!in_array($pr, ['low','medium','high'])) { json_response(['error' => 'Invalid priority'], 400); }
            $fields[] = 'priority = ?'; $params[] = $pr;
        }
        if (array_key_exists('description', $input)) {
            $fields[] = 'description = ?'; $params[] = (string)$input['description'];
        }
        if (array_key_exists('dueDate', $input)) {
            $fields[] = 'due_date = ?'; $params[] = ($input['dueDate'] !== '' ? $input['dueDate'] : null);
        }

        if (empty($fields)) {
            json_response(['message' => 'No changes'], 200);
        }

        $params[] = $id;
        $sql = 'UPDATE tasks SET ' . implode(', ', $fields) . ' WHERE id = ?';
        try {
            $pdo->prepare($sql)->execute($params);
            json_response(['message' => 'Task updated']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to update task'], 500);
        }
    }

    // DELETE /tasks/{id}
    public static function delete(int $id): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $stmt = $pdo->prepare('SELECT id, company_id AS companyId FROM tasks WHERE id = ?');
        $stmt->execute([$id]);
        $task = $stmt->fetch();
        if (!$task) { json_response(['error' => 'Not found'], 404); }

        if (!self::isSuperadmin($claims)) {
            $cid = $task['companyId'] !== null ? (int)$task['companyId'] : null;
            if ($cid === null || ($claims['company_id'] ?? null) !== $cid) {
                json_response(['error' => 'Forbidden'], 403);
            }
        }

        try {
            $pdo->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
            json_response(['message' => 'Task deleted']);
        } catch (Throwable $e) {
            json_response(['error' => 'Failed to delete task'], 500);
        }
    }

    // GET /tasks/stats?companyId=
    public static function stats(): void
    {
        $claims = self::requireAuth();
        $pdo = db();

        $isSuper = self::isSuperadmin($claims);
        $companyIdParam = $_GET['companyId'] ?? null;
        $companyId = ($companyIdParam === null || $companyIdParam === '')
            ? ($isSuper ? null : ($claims['company_id'] ?? null))
            : (int)$companyIdParam;

        $where = [];
        $params = [];
        if ($companyId !== null) { $where[] = 'company_id = ?'; $params[] = $companyId; }
        $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

        $counts = [
            'total' => 0,
            'pending' => 0,
            'in_progress' => 0,
            'completed' => 0,
            'electrical' => 0,
            'mechanical' => 0,
            'dueSoon' => 0
        ];

        $stmt = $pdo->prepare("SELECT COUNT(*) FROM tasks $whereSql");
        $stmt->execute($params);
        $counts['total'] = (int)$stmt->fetchColumn();

        foreach (['pending','in_progress','completed'] as $st) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM tasks $whereSql" . (strlen($whereSql) ? " AND" : " WHERE") . " status = ?");
            $stmt->execute(array_merge($params, [$st]));
            $counts[$st] = (int)$stmt->fetchColumn();
        }

        foreach (['Electrical' => 'electrical', 'Mechanical' => 'mechanical'] as $catVal => $key) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM tasks $whereSql" . (strlen($whereSql) ? " AND" : " WHERE") . " category = ?");
            $stmt->execute(array_merge($params, [$catVal]));
            $counts[$key] = (int)$stmt->fetchColumn();
        }

        // dueSoon: due in next 7 days and not completed
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM tasks $whereSql" . (strlen($whereSql) ? " AND" : " WHERE") . " status <> 'completed' AND due_date IS NOT NULL AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)");
        $stmt->execute($params);
        $counts['dueSoon'] = (int)$stmt->fetchColumn();

        json_response($counts);
    }
}