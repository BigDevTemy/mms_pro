-- Create companies table
CREATE TABLE IF NOT EXISTS `companies` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `address` text,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert sample data
INSERT IGNORE INTO `companies` (`name`, `address`, `phone`, `email`) VALUES
('Acme Corporation', '123 Business Ave, Tech City', '+1234567890', 'info@acme.com'),
('Globex Inc', '456 Corporate Blvd, Metro', '+1987654321', 'contact@globex.com'),
('Initech', '789 Enterprise St, Downtown', '+1122334455', 'support@initech.com'),
('Umbrella Corp', '1 Research Park, Raccoon City', '+1555666777', 'hq@umbrellacorp.com'),
('Stark Industries', '200 Industrial Way, New York', '+1888999000', 'tony@starkindustries.com');
