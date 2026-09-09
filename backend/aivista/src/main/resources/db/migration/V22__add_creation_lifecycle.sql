ALTER TABLE `creation_tasks`
    ADD COLUMN `status` VARCHAR(16) DEFAULT NULL COMMENT 'RUNNING、SUCCEEDED、FAILED 或 CANCELLED' AFTER `mode`,
    ADD COLUMN `failure_code` VARCHAR(64) DEFAULT NULL COMMENT '稳定失败分类' AFTER `status`,
    ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '业务状态与快照版本' AFTER `failure_code`,
    ADD COLUMN `completed_at` DATETIME(3) DEFAULT NULL COMMENT '进入终态时间' AFTER `revision`;

UPDATE `creation_tasks` c
LEFT JOIN (
    SELECT creation_task_id,
           CASE
               WHEN SUM(status IN ('SUCCEEDED', 'PARTIALLY_SUCCEEDED')) > 0 THEN 'SUCCEEDED'
               WHEN SUM(status = 'QUEUED') > 0 THEN 'RUNNING'
               ELSE 'FAILED'
           END AS creation_status,
           MAX(CASE WHEN status = 'FAILED' THEN failure_code ELSE NULL END) AS failure_code,
           MAX(completed_at) AS completed_at
    FROM generation_tasks
    GROUP BY creation_task_id
) g ON g.creation_task_id = c.id
SET c.status = CASE
        WHEN g.creation_status IS NULL THEN 'RUNNING'
        ELSE g.creation_status
    END,
    c.failure_code = CASE WHEN g.creation_status = 'FAILED' THEN g.failure_code ELSE NULL END,
    c.revision = CASE WHEN g.creation_status IN ('SUCCEEDED', 'FAILED') THEN 1 ELSE 0 END,
    c.completed_at = CASE WHEN g.creation_status IN ('SUCCEEDED', 'FAILED') THEN g.completed_at ELSE NULL END;

ALTER TABLE `creation_tasks`
    MODIFY COLUMN `status` VARCHAR(16) NOT NULL COMMENT 'RUNNING、SUCCEEDED、FAILED 或 CANCELLED';
