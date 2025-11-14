<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/controllers/AuthController.php';
require_once __DIR__ . '/controllers/AdminController.php';
require_once __DIR__ . '/controllers/AssetsController.php';
require_once __DIR__ . '/controllers/CompaniesController.php';
require_once __DIR__ . '/controllers/MachineStructureController.php';
require_once __DIR__ . '/controllers/CompanySchemaController.php';
require_once __DIR__ . '/controllers/CompanyDataController.php';
require_once __DIR__ . '/controllers/WorkOrdersController.php';
require_once __DIR__ . '/controllers/TasksController.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Normalize when hosted under /backend/api/ or directly
$scriptDir = rtrim(str_replace('index.php', '', $_SERVER['SCRIPT_NAME']), '/');
if ($scriptDir && str_starts_with($path, $scriptDir)) {
    $path = substr($path, strlen($scriptDir));
}
$path = '/' . trim($path, '/');

if ($method === 'GET' && $path === '/') {
    json_response(['ok' => true, 'service' => 'mms-pro-api']);
}

if ($method === 'POST' && $path === '/auth/login') {
    AuthController::login();
}
if ($method === 'POST' && $path === '/auth/register_company') {
    AuthController::registerCompany();
}
if ($method === 'POST' && $path === '/auth/register_superadmin') {
    AuthController::registerSuperadmin();
}
if ($method === 'GET' && $path === '/auth/me') {
    AuthController::me();
}
if ($method === 'POST' && $path === '/auth/refresh') {
    AuthController::refresh();
}
if ($method === 'POST' && $path === '/auth/logout') {
    AuthController::logout();
}
if ($method === 'POST' && $path === '/auth/request_password_reset') {
    AuthController::requestPasswordReset();
}
if ($method === 'POST' && $path === '/auth/reset_password') {
    AuthController::resetPassword();
}

// Admin endpoints
if ($method === 'POST' && $path === '/admin/users') {
    AdminController::createUser();
}
if ($method === 'GET' && $path === '/admin/users') {
    AdminController::listUsers();
}
if ($method === 'PUT' && preg_match('#^/admin/users/(\d+)$#', $path, $m)) {
    AdminController::updateUser((int)$m[1]);
}
if ($method === 'DELETE' && preg_match('#^/admin/users/(\d+)$#', $path, $m)) {
    AdminController::deleteUser((int)$m[1]);
}
if ($method === 'POST' && $path === '/admin/users/bulk') {
    AdminController::bulkCreateUsers();
}
if (preg_match('#^/admin/users/(\d+)/deactivate$#', $path, $m) && $method === 'POST') {
    AdminController::deactivateUser((int)$m[1]);
}
// Admin: stats, roles, permissions
if ($method === 'GET' && $path === '/admin/stats') {
    AdminController::stats();
}
if ($method === 'GET' && $path === '/admin/roles') {
    AdminController::listRoles();
}
if ($method === 'POST' && $path === '/admin/roles') {
    AdminController::createRole();
}
if ($method === 'PUT' && preg_match('#^/admin/roles/(\d+)$#', $path, $m)) {
    AdminController::updateRole((int)$m[1]);
}
if ($method === 'DELETE' && preg_match('#^/admin/roles/(\d+)$#', $path, $m)) {
    AdminController::deleteRole((int)$m[1]);
}
if ($method === 'GET' && preg_match('#^/admin/roles/(\d+)/permissions$#', $path, $m)) {
    AdminController::getRolePermissions((int)$m[1]);
}
if ($method === 'POST' && preg_match('#^/admin/roles/(\d+)/permissions$#', $path, $m)) {
    AdminController::assignPermissionToRole((int)$m[1]);
}
if ($method === 'DELETE' && preg_match('#^/admin/roles/(\d+)/permissions/(\d+)$#', $path, $m)) {
    AdminController::removePermissionFromRole((int)$m[1], (int)$m[2]);
}
if ($method === 'GET' && $path === '/admin/permissions') {
    AdminController::listPermissions();
}
if ($method === 'POST' && $path === '/admin/permissions') {
    AdminController::createPermission();
}
if ($method === 'PUT' && preg_match('#^/admin/permissions/(\d+)$#', $path, $m)) {
    AdminController::updatePermission((int)$m[1]);
}
if ($method === 'DELETE' && preg_match('#^/admin/permissions/(\d+)$#', $path, $m)) {
    AdminController::deletePermission((int)$m[1]);
}

// Work Orders
if ($method === 'GET' && $path === '/workorders') {
    WorkOrdersController::list();
}
if ($method === 'POST' && $path === '/workorders') {
    WorkOrdersController::create();
}
if (preg_match('#^/workorders/(\\d+)$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'GET') { WorkOrdersController::get($id); }
    if ($method === 'PUT' || $method === 'PATCH') { WorkOrdersController::update($id); }
    if ($method === 'DELETE') { WorkOrdersController::delete($id); }
}
if ($method === 'GET' && $path === '/workorders/stats') {
    WorkOrdersController::stats();
}
if ($method === 'GET' && $path === '/workorders/machines') {
    WorkOrdersController::machines();
}

// Sample protected endpoint (requires asset.view)
if ($method === 'GET' && $path === '/assets/demo') {
    AssetsController::listDemo();
}

// Assets CRUD
if ($method === 'GET' && $path === '/assets') {
    AssetsController::list();
}
if ($method === 'POST' && $path === '/assets') {
    AssetsController::create();
}
if (preg_match('#^/assets/(\d+)$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'GET') { AssetsController::get($id); }
    if ($method === 'PUT' || $method === 'PATCH') { AssetsController::update($id); }
    if ($method === 'DELETE') { AssetsController::delete($id); }
}

// Tasks
if ($method === 'GET' && $path === '/tasks') {
    TasksController::list();
}
if ($method === 'POST' && $path === '/tasks') {
    TasksController::create();
}
if (preg_match('#^/tasks/(\\d+)$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'GET') { TasksController::get($id); }
    if ($method === 'PUT' || $method === 'PATCH') { TasksController::update($id); }
    if ($method === 'DELETE') { TasksController::delete($id); }
}
if ($method === 'GET' && $path === '/tasks/stats') {
    TasksController::stats();
}

// Companies (superadmin / company.manage)
if ($method === 'GET' && $path === '/companies') {
    CompaniesController::list();
}
if ($method === 'POST' && $path === '/companies') {
    CompaniesController::create();
}
if (preg_match('#^/companies/(\d+)$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'GET') { CompaniesController::get($id); }
    if ($method === 'PUT' || $method === 'PATCH') { CompaniesController::update($id); }
    if ($method === 'DELETE') { CompaniesController::delete($id); }
}
 
// Machine Structure per company
if (preg_match('#^/companies/(\d+)/machine-structure$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'GET') { MachineStructureController::getStructure($id); }
    if ($method === 'PUT' || $method === 'PATCH') { MachineStructureController::upsertStructure($id); }
}
 
// Apply per-company physical schema (Option A)
if (preg_match('#^/companies/(\d+)/schema/apply$#', $path, $m)) {
    $id = (int)$m[1];
    if ($method === 'POST') { CompanySchemaController::apply($id); }
}

// Dynamic per-type CRUD using applied schema/registry
// /companies/{id}/data/{typeKey}
if (preg_match('#^/companies/(\d+)/data/([a-zA-Z0-9_]+)$#', $path, $m)) {
    $companyId = (int)$m[1];
    $typeKey = $m[2];
    if ($method === 'GET') { CompanyDataController::list($companyId, $typeKey); }
    if ($method === 'POST') { CompanyDataController::create($companyId, $typeKey); }
}
// /companies/{id}/data/{typeKey}/{rowId}
if (preg_match('#^/companies/(\d+)/data/([a-zA-Z0-9_]+)/(\d+)$#', $path, $m)) {
    $companyId = (int)$m[1];
    $typeKey = $m[2];
    $rowId = (int)$m[3];
    if ($method === 'GET') { CompanyDataController::get($companyId, $typeKey, $rowId); }
    if ($method === 'PUT' || $method === 'PATCH') { CompanyDataController::update($companyId, $typeKey, $rowId); }
    if ($method === 'DELETE') { CompanyDataController::delete($companyId, $typeKey, $rowId); }
}

json_response(['error' => 'Not found', 'path' => $path], 404);


