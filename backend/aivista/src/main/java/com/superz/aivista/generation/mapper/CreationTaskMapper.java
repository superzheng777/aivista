package com.superz.aivista.generation.mapper;

import com.mybatisflex.core.BaseMapper;
import com.superz.aivista.generation.entity.CreationTask;
import java.util.List;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** 会话创作轮次数据访问接口。 */
public interface CreationTaskMapper extends BaseMapper<CreationTask> {

    @Select("""
            SELECT id, user_id, session_id, mode, status, failure_code,
                   revision, completed_at, created_at, updated_at
            FROM creation_tasks
            WHERE id = #{creationTaskId}
            LIMIT 1
            """)
    CreationTask selectSnapshotById(@Param("creationTaskId") long creationTaskId);

    @Select("""
            SELECT id, user_id, session_id, mode, status, failure_code,
                   revision, completed_at, created_at, updated_at
            FROM creation_tasks
            WHERE id = #{creationTaskId}
            FOR UPDATE
            """)
    CreationTask selectByIdForUpdate(@Param("creationTaskId") long creationTaskId);

    @Select("""
            SELECT id, user_id, session_id, mode, status, failure_code,
                   revision, completed_at, created_at, updated_at
            FROM creation_tasks
            WHERE session_id = #{sessionId}
              AND (#{beforeId} IS NULL OR id < #{beforeId})
            ORDER BY id DESC
            LIMIT #{limit}
            """)
    List<CreationTask> selectPageBySessionId(
            @Param("sessionId") long sessionId,
            @Param("beforeId") Long beforeId,
            @Param("limit") int limit);

    @Update("""
            UPDATE creation_tasks
            SET status = #{status}, failure_code = #{failureCode}, revision = revision + 1,
                completed_at = #{completedAt}, updated_at = #{completedAt}
            WHERE id = #{creationTaskId} AND status = 'RUNNING' AND revision = #{expectedRevision}
            """)
    int completeRunning(@Param("creationTaskId") long creationTaskId,
            @Param("expectedRevision") long expectedRevision,
            @Param("status") String status,
            @Param("failureCode") String failureCode,
            @Param("completedAt") java.time.Instant completedAt);
}
