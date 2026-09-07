CREATE TABLE `generation_worker_executions` (
    `task_id` BIGINT UNSIGNED NOT NULL,
    `phase` VARCHAR(16) NOT NULL,
    `task_version` INT UNSIGNED NOT NULL,
    `state` VARCHAR(16) NOT NULL COMMENT 'READY, CALLING, COMPLETED',
    `result_json` JSON DEFAULT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`task_id`, `phase`, `task_version`),
    KEY `idx_generation_worker_execution_state` (`state`, `updated_at`),
    CONSTRAINT `fk_generation_worker_executions_task_id`
        FOREIGN KEY (`task_id`) REFERENCES `generation_tasks` (`id`) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
