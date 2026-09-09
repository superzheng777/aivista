-- A normal Creation currently owns one generation task, while an Agent Creation may invoke
-- image generation more than once in the same Pi loop. Keep the relationship indexed, but
-- do not encode the normal-mode cardinality as a database-wide uniqueness constraint.
ALTER TABLE `generation_tasks`
    DROP INDEX `uk_generation_tasks_creation_task`,
    ADD KEY `idx_generation_tasks_creation_created` (`creation_task_id`, `created_at`, `id`);
