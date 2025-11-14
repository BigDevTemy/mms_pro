-- Add maintenance type to tasks
ALTER TABLE `tasks`
  ADD COLUMN `maint_type` ENUM('Preventive','Corrective','Predictive','Inspection') NOT NULL DEFAULT 'Preventive' AFTER `frequency`,
  ADD KEY `idx_tasks_maint_type` (`maint_type`);