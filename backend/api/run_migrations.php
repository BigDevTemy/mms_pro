<?php
// CLI migration runner to create DB and apply SQL migrations without mysql CLI.
// Usage: php backend/api/run_migrations.php

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This script must be run from CLI\n");
    exit(1);
}

require_once __DIR__ . '/config.php'; // for $env (DB_HOST, DB_NAME, DB_USER, DB_PASS)

// Get DB connection params (fallbacks mirror config.php)
$host = $env['DB_HOST'] ?? '127.0.0.1';
$db  = $env['DB_NAME'] ?? 'mms_pro';
$user = $env['DB_USER'] ?? 'root';
$pass = $env['DB_PASS'] ?? '';

function pdo_connect_server(string $host, string $user, string $pass): PDO {
    $dsn = "mysql:host={$host};charset=utf8mb4";
    $opt = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];
    return new PDO($dsn, $user, $pass, $opt);
}

function pdo_connect_db(string $host, string $db, string $user, string $pass): PDO {
    $dsn = "mysql:host={$host};dbname={$db};charset=utf8mb4";
    $opt = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];
    return new PDO($dsn, $user, $pass, $opt);
}

// Robust SQL splitter (handles ; outside of string literals and strips comments)
function splitSqlStatements(string $sql): array {
    $stmts = [];
    $len = strlen($sql);
    $buf = '';
    $inString = false;
    $quote = '';
    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];

        // Handle line comments --
        if (!$inString && $ch === '-' && $i + 1 < $len && $sql[$i + 1] === '-') {
            // skip till end of line
            while ($i < $len && $sql[$i] !== "\n") { $i++; }
            continue;
        }

        // Handle block comments /* ... */
        if (!$inString && $ch === '/' && $i + 1 < $len && $sql[$i + 1] === '*') {
            $i += 2;
            while ($i + 1 < $len && !($sql[$i] === '*' && $sql[$i + 1] === '/')) { $i++; }
            $i++; // skip closing '/'
            continue;
        }

        // Enter/exit strings
        if (!$inString && ($ch === "'" || $ch === '"')) {
            $inString = true;
            $quote = $ch;
            $buf .= $ch;
            continue;
        } elseif ($inString) {
            $buf .= $ch;
            if ($ch === $quote) {
                // Check for escaped quote by doubling '' or "" (MySQL treats backslash by default too, but we keep simple)
                $next = $i + 1 < $len ? $sql[$i + 1] : '';
                if ($next === $quote) {
                    // escaped by doubling, consume it
                    $buf .= $next;
                    $i++;
                } else {
                    $inString = false;
                    $quote = '';
                }
            }
            continue;
        }

        // Split at semicolons (outside strings)
        if ($ch === ';') {
            $stmt = trim($buf);
            if ($stmt !== '') {
                $stmts[] = $stmt;
            }
            $buf = '';
            continue;
        }

        $buf .= $ch;
    }

    $tail = trim($buf);
    if ($tail !== '') {
        $stmts[] = $tail;
    }

    return $stmts;
}

function applySqlFile(PDO $pdo, string $file): void {
    if (!file_exists($file)) {
        throw new RuntimeException("Migration file not found: {$file}");
    }
    $sql = file_get_contents($file);
    if ($sql === false) {
        throw new RuntimeException("Failed to read file: {$file}");
    }
    $statements = splitSqlStatements($sql);
    foreach ($statements as $stmt) {
        // skip pure comments or empties
        if ($stmt === '' || preg_match('/^\s*(--|#)/', $stmt)) {
            continue;
        }
        try {
            $pdo->exec($stmt);
        } catch (Throwable $e) {
            // Make migrations idempotent by ignoring common "already exists"/duplicate errors
            $msg = $e->getMessage();
            $nonFatal =
                str_contains($msg, 'Duplicate column name') ||    // 1060
                str_contains($msg, 'already exists') ||           // 1050 table exists
                str_contains($msg, 'Duplicate key name') ||       // 1061
                str_contains($msg, 'Duplicate entry') ||          // 1062
                str_contains($msg, 'column exists') ||            // vendor variations
                str_contains($msg, 'exists');                     // generic safety
            if ($nonFatal) {
                echo "Skipping non-fatal migration statement from {$file}: {$msg}\n";
                continue;
            }
            throw $e;
        }
    }
}

/**
 * Ensure legacy companies table has the columns expected by 001 migration inserts.
 * Some environments may already have a simplified companies table without address/phone/email.
 * We add missing columns only if they do not exist (via information_schema lookup).
 */
function columnExists(PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1");
    $stmt->execute([$table, $column]);
    return (bool)$stmt->fetchColumn();
}
function ensureCompaniesColumns(PDO $pdo): void {
    if (!columnExists($pdo, 'companies', 'address')) {
        $pdo->exec("ALTER TABLE `companies` ADD COLUMN `address` TEXT NULL");
    }
    if (!columnExists($pdo, 'companies', 'phone')) {
        $pdo->exec("ALTER TABLE `companies` ADD COLUMN `phone` VARCHAR(20) NULL");
    }
    if (!columnExists($pdo, 'companies', 'email')) {
        $pdo->exec("ALTER TABLE `companies` ADD COLUMN `email` VARCHAR(100) NULL");
    }
}

try {
    echo "Connecting to MySQL server {$host}...\n";
    $pdoServer = pdo_connect_server($host, $user, $pass);
 
    echo "Ensuring database '{$db}' exists...\n";
    $pdoServer->exec("CREATE DATABASE IF NOT EXISTS `{$db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
 
    echo "Connecting to database '{$db}'...\n";
    $pdo = pdo_connect_db($host, $db, $user, $pass);

    // Reconcile schema drift before running migrations that insert sample data.
    echo "Reconciling companies table columns (address/phone/email)...\n";
    ensureCompaniesColumns($pdo);
 
    $migrationsDir = __DIR__ . DIRECTORY_SEPARATOR . 'migrations';
    $baseSchema = __DIR__ . DIRECTORY_SEPARATOR . 'migrations.sql';
    $migrations = [
        // Ensure core tables (roles, permissions, role_permissions, users, etc.) exist first
        $baseSchema,
        $migrationsDir . DIRECTORY_SEPARATOR . '001_create_companies_table.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '002_create_machine_structures_table.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '003_seed_machine_structures.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '004_create_company_schema_meta.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '005_create_tasks_table.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '006_add_maint_type_to_tasks.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '007_create_work_orders_table.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '008_add_shutdown_and_machine_to_work_orders.sql',
        $migrationsDir . DIRECTORY_SEPARATOR . '009_machine_ref_lastchild.sql',
    ];
 
    foreach ($migrations as $file) {
        echo "Applying migration: {$file}\n";
        applySqlFile($pdo, $file);
    }
 
    echo "All migrations applied successfully.\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "Migration failed: " . $e->getMessage() . "\n");
    exit(1);
}