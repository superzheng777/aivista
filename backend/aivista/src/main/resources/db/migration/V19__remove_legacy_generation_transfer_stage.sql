UPDATE `generation_tasks`
SET `status` = 'FAILED',
    `failure_code` = 'IMAGE_TRANSFER_FAILED',
    `task_version` = `task_version` + 1,
    `completed_at` = COALESCE(`completed_at`, CURRENT_TIMESTAMP(3)),
    `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `status` = 'TRANSFERRING';

DELETE FROM `outbox_events`
WHERE `event_type` = 'GENERATION_IMAGE_TRANSFER';

ALTER TABLE `generation_tasks`
    DROP INDEX `idx_generation_tasks_transfer_waiting`,
    DROP COLUMN `provider_result_snapshot`,
    DROP COLUMN `transfer_started_at`;
