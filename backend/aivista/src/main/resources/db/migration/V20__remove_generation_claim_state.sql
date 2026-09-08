DELETE FROM `outbox_events`
WHERE `event_type` = 'GENERATION_TASK_STATUS_CHANGED'
  AND JSON_UNQUOTE(JSON_EXTRACT(`payload_json`, '$.status')) = 'RUNNING';

UPDATE `generation_tasks`
SET `status` = 'QUEUED',
    `task_version` = GREATEST(`task_version` - 1, 0),
    `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `status` = 'RUNNING';

ALTER TABLE `generation_tasks`
    DROP COLUMN `provider_call_started_at`,
    DROP COLUMN `started_at`;
