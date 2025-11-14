<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Database connection
$host = 'localhost';
$dbname = 'mms_pro';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit();
}

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Get the request method
$method = $_SERVER['REQUEST_METHOD'];
$request = explode("/", substr(@$_SERVER['PATH_INFO'], 1));
$id = isset($request[0]) ? intval($request[0]) : null;

// Get request data
$data = json_decode(file_get_contents('php://input'), true);

// Handle different HTTP methods
switch ($method) {
    case 'GET':
        if ($id) {
            // Get single company
            try {
                $stmt = $pdo->prepare('SELECT * FROM companies WHERE id = ?');
                $stmt->execute([$id]);
                $company = $stmt->fetch(PDO::FETCH_ASSOC);
                
                if ($company) {
                    echo json_encode($company);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Company not found']);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to fetch company']);
            }
        } else {
            // Get all companies
            try {
                $search = isset($_GET['search']) ? '%' . $_GET['search'] . '%' : '%';
                $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
                $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
                $offset = ($page - 1) * $limit;
                
                // Get total count for pagination
                $stmt = $pdo->prepare('SELECT COUNT(*) as total FROM companies WHERE name LIKE ?');
                $stmt->execute([$search]);
                $total = $stmt->fetch(PDO::FETCH_ASSOC)['total'];
                
                // Get paginated companies
                $stmt = $pdo->prepare('SELECT * FROM companies WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
                $stmt->execute([$search, $limit, $offset]);
                $companies = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                echo json_encode([
                    'data' => $companies,
                    'pagination' => [
                        'total' => (int)$total,
                        'page' => $page,
                        'limit' => $limit,
                        'totalPages' => ceil($total / $limit)
                    ]
                ]);
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to fetch companies']);
            }
        }
        break;
        
    case 'POST':
        // Create new company
        try {
            $name = trim($data['name'] ?? '');
            $address = trim($data['address'] ?? '');
            $phone = trim($data['phone'] ?? '');
            $email = trim($data['email'] ?? '');
            
            if (empty($name)) {
                http_response_code(400);
                echo json_encode(['error' => 'Company name is required']);
                exit();
            }
            
            $stmt = $pdo->prepare('INSERT INTO companies (name, address, phone, email) VALUES (?, ?, ?, ?)');
            $stmt->execute([$name, $address, $phone, $email]);
            
            $companyId = $pdo->lastInsertId();
            $stmt = $pdo->prepare('SELECT * FROM companies WHERE id = ?');
            $stmt->execute([$companyId]);
            $company = $stmt->fetch(PDO::FETCH_ASSOC);
            
            http_response_code(201);
            echo json_encode($company);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to create company']);
        }
        break;
        
    case 'PUT':
        // Update company
        if (!$id) {
            http_response_code(400);
            echo json_encode(['error' => 'Company ID is required']);
            exit();
        }
        
        try {
            $name = trim($data['name'] ?? '');
            $address = trim($data['address'] ?? '');
            $phone = trim($data['phone'] ?? '');
            $email = trim($data['email'] ?? '');
            
            if (empty($name)) {
                http_response_code(400);
                echo json_encode(['error' => 'Company name is required']);
                exit();
            }
            
            $stmt = $pdo->prepare('UPDATE companies SET name = ?, address = ?, phone = ?, email = ?, updated_at = NOW() WHERE id = ?');
            $stmt->execute([$name, $address, $phone, $email, $id]);
            
            if ($stmt->rowCount() > 0) {
                $stmt = $pdo->prepare('SELECT * FROM companies WHERE id = ?');
                $stmt->execute([$id]);
                $company = $stmt->fetch(PDO::FETCH_ASSOC);
                
                echo json_encode($company);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Company not found']);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update company']);
        }
        break;
        
    case 'DELETE':
        // Delete company
        if (!$id) {
            http_response_code(400);
            echo json_encode(['error' => 'Company ID is required']);
            exit();
        }
        
        try {
            // First, check if the company exists
            $stmt = $pdo->prepare('SELECT id FROM companies WHERE id = ?');
            $stmt->execute([$id]);
            
            if ($stmt->rowCount() === 0) {
                http_response_code(404);
                echo json_encode(['error' => 'Company not found']);
                exit();
            }
            
            // Delete the company
            $stmt = $pdo->prepare('DELETE FROM companies WHERE id = ?');
            $stmt->execute([$id]);
            
            echo json_encode(['message' => 'Company deleted successfully']);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to delete company']);
        }
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
        break;
}
