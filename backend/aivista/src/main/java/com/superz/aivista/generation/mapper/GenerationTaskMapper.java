package com.superz.aivista.generation.mapper;

import com.mybatisflex.core.BaseMapper;
import com.superz.aivista.generation.entity.GenerationTask;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** 生成任务数据访问接口，包含各阶段的条件状态迁移与超时扫描。 */
public interface GenerationTaskMapper extends BaseMapper<GenerationTask> {

    @Select("SELECT creation_task_id FROM generation_tasks WHERE id = #{taskId} LIMIT 1")
    Long selectCreationTaskId(@Param("taskId") long taskId);

    @Select("""
            SELECT id, user_id, session_id, creation_task_id, model, status, task_version,
                   attempt_count, final_prompt, final_negative_prompt,
                   width, height, prompt_extend, requested_image_count, completed_image_count, quota_refunded_at,
                   provider_request_id,
                   failure_code, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE id = #{taskId} AND user_id = #{userId}
            LIMIT 1
            """)
    GenerationTask selectOwnedById(@Param("userId") long userId, @Param("taskId") long taskId);

    @Select("""
            SELECT id, user_id, session_id, creation_task_id, model, status, task_version,
                   attempt_count, final_prompt, final_negative_prompt,
                   width, height, prompt_extend, requested_image_count, completed_image_count, quota_refunded_at,
                   provider_request_id,
                   failure_code, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE id = #{taskId} AND user_id = #{userId}
            FOR UPDATE
            """)
    GenerationTask selectOwnedByIdForUpdate(@Param("userId") long userId, @Param("taskId") long taskId);

    @Select("""
            <script>
            SELECT id, user_id, session_id, status, task_version
            FROM generation_tasks
            WHERE id IN
            <foreach collection="taskIds" item="taskId" open="(" separator="," close=")">#{taskId}</foreach>
            </script>
            """)
    List<GenerationTask> selectStatusEventTasksByIds(@Param("taskIds") List<Long> taskIds);

    @Select("""
            <script>
            SELECT id, session_id, status, task_version
            FROM (
                SELECT id, session_id, status, task_version,
                       ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS latest_row_num
                FROM generation_tasks
                WHERE session_id IN
                <foreach collection="sessionIds" item="sessionId" open="(" separator="," close=")">
                    #{sessionId}
                </foreach>
            ) latest_tasks
            WHERE latest_row_num = 1
            </script>
            """)
    List<GenerationTask> selectLatestBySessionIds(@Param("sessionIds") List<Long> sessionIds);

    @Select("""
            <script>
            SELECT DISTINCT session_id
            FROM generation_tasks
            WHERE status = 'QUEUED'
              AND session_id IN
            <foreach collection="sessionIds" item="sessionId" open="(" separator="," close=")">#{sessionId}</foreach>
            </script>
            """)
    List<Long> selectActiveSessionIds(@Param("sessionIds") List<Long> sessionIds);

    @Select("""
            <script>
            SELECT id, user_id, session_id, creation_task_id, model, status, task_version,
                   attempt_count, final_prompt, final_negative_prompt,
                   width, height, prompt_extend, requested_image_count, completed_image_count, quota_refunded_at,
                   provider_request_id,
                   failure_code, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE creation_task_id IN
            <foreach collection="creationTaskIds" item="creationTaskId" open="(" separator="," close=")">
                #{creationTaskId}
            </foreach>
            ORDER BY creation_task_id, created_at, id
            </script>
            """)
    List<GenerationTask> selectByCreationTaskIds(@Param("creationTaskIds") List<Long> creationTaskIds);

    @Select("""
            SELECT COUNT(*)
            FROM generation_tasks
            WHERE user_id = #{userId}
              AND status = 'QUEUED'
            """)
    int countActiveByUserId(@Param("userId") long userId);

    @Select("""
            SELECT COUNT(*)
            FROM generation_tasks
            WHERE session_id = #{sessionId}
              AND status = 'QUEUED'
            """)
    int countActiveBySessionId(@Param("sessionId") long sessionId);

    @Select("""
            SELECT id, user_id, session_id, creation_task_id, model, status, task_version,
                   attempt_count, final_prompt, final_negative_prompt,
                   width, height, prompt_extend, requested_image_count, completed_image_count, quota_refunded_at,
                   provider_request_id,
                   failure_code, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE id = #{taskId}
            FOR UPDATE
            """)
    GenerationTask selectByIdForUpdate(@Param("taskId") long taskId);

    @Select("""
            SELECT id, user_id, session_id, creation_task_id, model, status, task_version,
                   attempt_count, final_prompt, final_negative_prompt,
                   width, height, prompt_extend, requested_image_count, completed_image_count, quota_refunded_at,
                   provider_request_id,
                   failure_code, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE status = 'QUEUED' AND updated_at < #{before}
            ORDER BY updated_at, id
            LIMIT #{limit}
            """)
    List<GenerationTask> selectQueuedBefore(@Param("before") Instant before, @Param("limit") int limit);

    @Update("""
            UPDATE generation_tasks
            SET status = 'FAILED', failure_code = #{failureCode}, task_version = task_version + 1,
                quota_refunded_at = #{quotaRefundedAt}, completed_at = #{completedAt}, updated_at = #{completedAt}
            WHERE id = #{taskId} AND status = 'QUEUED' AND task_version = #{taskVersion}
            """)
    int failQueued(@Param("taskId") long taskId, @Param("taskVersion") int taskVersion,
            @Param("failureCode") String failureCode, @Param("quotaRefundedAt") Instant quotaRefundedAt,
            @Param("completedAt") Instant completedAt);

    @Update("""
            UPDATE generation_tasks
            SET status = #{status}, task_version = task_version + 1, completed_image_count = #{completedImageCount},
                failure_code = #{failureCode}, provider_request_id = #{providerRequestId},
                completed_at = #{now}, updated_at = #{now}
            WHERE id = #{taskId} AND status = 'QUEUED' AND task_version = #{taskVersion}
            """)
    int completeQueuedPipeline(@Param("taskId") long taskId, @Param("taskVersion") int taskVersion,
            @Param("status") String status, @Param("completedImageCount") int completedImageCount,
            @Param("failureCode") String failureCode, @Param("providerRequestId") String providerRequestId,
            @Param("now") Instant now);

    @Update("""
            UPDATE generation_tasks
            SET status = 'FAILED', task_version = task_version + 1, failure_code = #{failureCode},
                provider_request_id = #{providerRequestId},
                quota_refunded_at = COALESCE(#{quotaRefundedAt}, quota_refunded_at),
                completed_at = #{now}, updated_at = #{now}
            WHERE id = #{taskId} AND status = 'QUEUED' AND task_version = #{taskVersion}
            """)
    int failQueuedPipeline(@Param("taskId") long taskId, @Param("taskVersion") int taskVersion,
            @Param("failureCode") String failureCode, @Param("providerRequestId") String providerRequestId,
            @Param("quotaRefundedAt") Instant quotaRefundedAt, @Param("now") Instant now);

}
