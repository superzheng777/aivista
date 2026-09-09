CREATE TABLE `agent_worker_executions` (
    `creation_task_id` BIGINT UNSIGNED NOT NULL COMMENT 'Agent Creation ID，也是幂等执行键',
    `state` VARCHAR(16) NOT NULL COMMENT 'RUNNING、COMPLETED 或 INTERRUPTED',
    `result_json` JSON DEFAULT NULL COMMENT 'Java Agent Completion 的可重放请求',
    `started_at` DATETIME(3) NOT NULL COMMENT '首次开始执行时间',
    `completed_at` DATETIME(3) DEFAULT NULL COMMENT '完成或确认中断时间',
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`creation_task_id`),
    KEY `idx_agent_worker_executions_state_updated` (`state`, `updated_at`),
    CONSTRAINT `fk_agent_worker_executions_creation_task_id`
        FOREIGN KEY (`creation_task_id`) REFERENCES `creation_tasks` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  COMMENT = 'TS Agent Worker 防重复与最终提交重放账本';
