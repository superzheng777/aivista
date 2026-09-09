package com.superz.aivista.generation.mapper;

import com.mybatisflex.core.BaseMapper;
import com.superz.aivista.generation.entity.CreationActivity;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface CreationActivityMapper extends BaseMapper<CreationActivity> {
    @Select("""
            SELECT id, creation_task_id, sequence_no, activity_type, activity_key, state,
                   content, tool_name, generation_task_id, started_at, completed_at
            FROM creation_activities
            WHERE creation_task_id = #{creationTaskId} AND activity_key = #{activityKey}
            LIMIT 1
            """)
    CreationActivity selectByKey(@Param("creationTaskId") long creationTaskId,
            @Param("activityKey") String activityKey);

    @Select("""
            <script>
            SELECT id, creation_task_id, sequence_no, activity_type, activity_key, state,
                   content, tool_name, generation_task_id, started_at, completed_at
            FROM creation_activities
            WHERE creation_task_id IN
            <foreach collection="creationTaskIds" item="creationTaskId" open="(" separator="," close=")">
                #{creationTaskId}
            </foreach>
            ORDER BY creation_task_id, sequence_no
            </script>
            """)
    List<CreationActivity> selectByCreationTaskIds(@Param("creationTaskIds") List<Long> creationTaskIds);

    @Select("SELECT COALESCE(MAX(sequence_no), 0) FROM creation_activities WHERE creation_task_id = #{creationTaskId}")
    int selectMaxSequenceNo(@Param("creationTaskId") long creationTaskId);

    @Update("""
            UPDATE creation_activities
            SET state = #{state}, content = #{content}, generation_task_id = #{generationTaskId},
                completed_at = #{completedAt}
            WHERE id = #{id} AND state = 'RUNNING'
            """)
    int completeRunning(@Param("id") long id, @Param("state") String state,
            @Param("content") String content, @Param("generationTaskId") Long generationTaskId,
            @Param("completedAt") Instant completedAt);
}
