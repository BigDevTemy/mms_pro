-- Work Orders: add dynamic last-child machine reference fields (non-FK)
-- We keep prior 008 columns (machine_id, was_shutdown, shutdown_*). This adds generic refs.
ALTER TABLE `work_orders`
  ADD COLUMN `machine_type_key` VARCHAR(64) NULL AFTER `machine_id`,
  ADD COLUMN `machine_row_id` BIGINT UNSIGNED NULL AFTER `machine_type_key`,
  ADD COLUMN `machine_name` VARCHAR(255) NULL AFTER `machine_row_id`,
  ADD KEY `idx_wo_machine_type` (`machine_type_key`),
  ADD KEY `idx_wo_machine_row` (`machine_row_id`);