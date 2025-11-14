<?php

require_once __DIR__ . '/../config.php';

class Permissions
{
    /**
     * Check if a user (by JWT claims) has a given permission.
     * If $companyId is provided, company-scoped roles for that company qualify.
     * Global roles (e.g., superadmin) always qualify if mapped to permission.
     */
    public static function userHasPermission(array $claims, string $permissionName, ?int $companyId = null): bool
    {
        // Extract role names and scope/company from token
        $roles = $claims['roles'] ?? [];
        if (!is_array($roles)) return false;

        // Prepare lookup in DB for role->permission mapping
        $pdo = db();
        $permStmt = $pdo->prepare('SELECT id FROM permissions WHERE name = ? LIMIT 1');
        $permStmt->execute([$permissionName]);
        $perm = $permStmt->fetch();
        if (!$perm) return false;
        $permissionId = (int)$perm['id'];

        // Build list of role ids to check based on claims
        $roleIds = [];
        if (count($roles) === 0) return false;

        // Fetch role ids by (name, scope) pairs present in claims
        $pairs = [];
        foreach ($roles as $r) {
            $name = $r['name'] ?? null;
            $scope = $r['scope'] ?? null;
            $rCompany = $r['company_id'] ?? null;
            if (!$name || !$scope) continue;
            // If scope is company, ensure company matches if a companyId is provided
            if ($scope === 'company' && $companyId !== null && (int)$rCompany !== (int)$companyId) {
                continue;
            }
            $pairs[] = [$name, $scope];
        }
        if (count($pairs) === 0) return false;

        // Query role ids for these pairs
        $in = implode(',', array_fill(0, count($pairs), '(?, ?)'));
        $params = [];
        foreach ($pairs as [$n, $s]) { $params[] = $n; $params[] = $s; }
        $stmt = $pdo->prepare("SELECT id FROM roles WHERE (name, scope) IN ($in)");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as $row) { $roleIds[] = (int)$row['id']; }
        if (count($roleIds) === 0) return false;

        // Check mapping
        $inRoles = implode(',', array_fill(0, count($roleIds), '?'));
        $rp = $pdo->prepare("SELECT 1 FROM role_permissions WHERE permission_id = ? AND role_id IN ($inRoles) LIMIT 1");
        $rp->execute(array_merge([$permissionId], $roleIds));
        return (bool)$rp->fetchColumn();
    }
}


