CREATE TABLE `creation_activities` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `creation_task_id` BIGINT UNSIGNED NOT NULL,
    `sequence_no` INT UNSIGNED NOT NULL,
    `activity_type` VARCHAR(16) NOT NULL COMMENT 'NARRATION、SKILL 或 TOOL',
    `activity_key` VARCHAR(128) NOT NULL COMMENT 'Creation 内稳定幂等键',
    `state` VARCHAR(16) NOT NULL COMMENT 'RUNNING、COMPLETED 或 FAILED',
    `content` VARCHAR(1000) NOT NULL COMMENT '用户可见的安全摘要',
    `tool_name` VARCHAR(64) DEFAULT NULL,
    `generation_task_id` BIGINT UNSIGNED DEFAULT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_creation_activities_sequence` (`creation_task_id`, `sequence_no`),
    UNIQUE KEY `uk_creation_activities_key` (`creation_task_id`, `activity_key`),
    CONSTRAINT `fk_creation_activities_creation_task_id`
        FOREIGN KEY (`creation_task_id`) REFERENCES `creation_tasks` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_creation_activities_generation_task_id`
        FOREIGN KEY (`generation_task_id`) REFERENCES `generation_tasks` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  COMMENT = '用户刷新后可恢复的 Agent 稳定步骤';
