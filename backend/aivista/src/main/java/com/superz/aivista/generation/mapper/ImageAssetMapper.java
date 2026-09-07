package com.superz.aivista.generation.mapper;

import com.mybatisflex.core.BaseMapper;
import com.superz.aivista.generation.entity.ImageAsset;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** Access to private image assets and their optional publication state. */
public interface ImageAssetMapper extends BaseMapper<ImageAsset> {
    String PUBLICATION_FIELDS = """
            p.review_status AS publication_review_status, p.publication_version,
            p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
            p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count
            """;

    @Select("SELECT a.*, " + PUBLICATION_FIELDS + " FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id WHERE a.id = #{assetId} AND a.user_id = #{userId} AND a.deleted_at IS NULL FOR UPDATE")
    ImageAsset selectVisibleOwnedByIdForUpdate(@Param("assetId") long assetId, @Param("userId") long userId);

    @Select("SELECT a.*, " + PUBLICATION_FIELDS + " FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id WHERE a.id = #{assetId} AND a.user_id = #{userId} FOR UPDATE")
    ImageAsset selectOwnedByIdForUpdate(@Param("assetId") long assetId, @Param("userId") long userId);

    @Select("SELECT a.*, " + PUBLICATION_FIELDS + " FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id WHERE a.id = #{assetId} FOR UPDATE")
    ImageAsset selectByAssetIdForUpdate(@Param("assetId") long assetId);

    @Select("SELECT a.*, " + PUBLICATION_FIELDS + " FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id WHERE a.id = #{assetId}")
    ImageAsset selectByAssetId(@Param("assetId") long assetId);

    @Select("""
            <script>
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count
            FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id
            WHERE a.id IN <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
            </script>
            """)
    List<ImageAsset> selectByAssetIds(@Param("assetIds") List<Long> assetIds);

    @Select("""
            <script>
            SELECT * FROM image_assets WHERE id IN
            <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
            ORDER BY id ASC FOR UPDATE
            </script>
            """)
    List<ImageAsset> selectByIdsForUpdate(@Param("assetIds") List<Long> assetIds);

    @Select("SELECT * FROM image_assets WHERE origin_task_id = #{taskId} ORDER BY source_index ASC")
    List<ImageAsset> selectByOriginTaskId(@Param("taskId") long taskId);

    @Select("""
            <script>
            SELECT * FROM image_assets WHERE origin_task_id IN
            <foreach collection="taskIds" item="taskId" open="(" separator="," close=")">#{taskId}</foreach>
            ORDER BY origin_task_id ASC, source_index ASC
            </script>
            """)
    List<ImageAsset> selectByOriginTaskIds(@Param("taskIds") List<Long> taskIds);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id
            LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE a.user_id = #{userId} AND a.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC
            """)
    List<ImageAsset> selectVisibleByUserId(@Param("userId") long userId);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id
            LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE a.id = #{assetId} AND a.user_id = #{userId} AND a.deleted_at IS NULL
            """)
    ImageAsset selectVisibleDetailByUserIdAndId(@Param("userId") long userId, @Param("assetId") long assetId);

    @Select("""
            <script>
            SELECT a.* FROM image_assets a LEFT JOIN image_publications p ON p.asset_id = a.id
            WHERE a.id IN <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(3))
              AND ((a.user_id = #{userId} AND a.deleted_at IS NULL)
                   OR (p.public_at IS NOT NULL AND p.review_status = 'APPROVED'))
            FOR UPDATE
            </script>
            """)
    List<ImageAsset> selectUsableInputsForUpdate(@Param("userId") long userId, @Param("assetIds") List<Long> assetIds);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id
            LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE p.public_at IS NOT NULL AND p.review_status = 'APPROVED'
              AND (#{cursorPublicAt} IS NULL OR p.public_at < #{cursorPublicAt} OR (p.public_at = #{cursorPublicAt} AND a.id < #{cursorAssetId}))
            ORDER BY p.public_at DESC, a.id DESC LIMIT #{limit}
            """)
    List<ImageAsset> selectPublishedPage(@Param("cursorPublicAt") Instant cursorPublicAt,
            @Param("cursorAssetId") Long cursorAssetId, @Param("limit") int limit);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM user_follows f INNER JOIN image_assets a ON a.user_id = f.following_user_id
            INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE f.follower_user_id = #{viewerUserId} AND p.public_at IS NOT NULL AND p.review_status = 'APPROVED'
              AND (#{cursorPublicAt} IS NULL OR p.public_at < #{cursorPublicAt} OR (p.public_at = #{cursorPublicAt} AND a.id < #{cursorAssetId}))
            ORDER BY p.public_at DESC, a.id DESC LIMIT #{limit}
            """)
    List<ImageAsset> selectFollowingPublishedPage(@Param("viewerUserId") long viewerUserId,
            @Param("cursorPublicAt") Instant cursorPublicAt, @Param("cursorAssetId") Long cursorAssetId, @Param("limit") int limit);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE a.id = #{assetId} AND p.public_at IS NOT NULL AND p.review_status = 'APPROVED'
            """)
    ImageAsset selectPublishedById(@Param("assetId") long assetId);

    @Select("""
            <script>
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE p.public_at IS NOT NULL AND p.review_status = 'APPROVED' AND a.id IN
            <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
            </script>
            """)
    List<ImageAsset> selectPublishedByIds(@Param("assetIds") List<Long> assetIds);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE p.public_at IS NOT NULL AND p.review_status = 'APPROVED' AND a.id > #{afterAssetId}
            ORDER BY a.id ASC LIMIT #{limit}
            """)
    List<ImageAsset> selectPublishedForSearchIndex(@Param("afterAssetId") long afterAssetId, @Param("limit") int limit);

    @Select("SELECT COUNT(*) FROM image_publications WHERE public_at IS NOT NULL AND review_status = 'APPROVED'")
    long countPublishedForSearchIndex();

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.review_attempt_count AS publication_review_attempt_count, p.review_started_at AS publication_review_started_at,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE a.user_id = #{userId} AND p.review_status IN ('PENDING', 'APPROVED') ORDER BY p.review_started_at DESC, a.id DESC
            """)
    List<ImageAsset> selectPublishedByUserId(@Param("userId") long userId);

    @Select("""
            SELECT a.*, p.review_status AS publication_review_status, p.publication_version,
                   p.title AS publication_title, p.description AS publication_description, p.public_at, p.like_count,
                   t.final_prompt AS publication_prompt, t.final_negative_prompt AS publication_negative_prompt,
                   t.requested_image_count AS publication_requested_image_count, t.prompt_extend AS publication_prompt_extend
            FROM image_assets a INNER JOIN image_publications p ON p.asset_id = a.id LEFT JOIN generation_tasks t ON t.id = a.origin_task_id
            WHERE a.user_id = #{userId} AND p.public_at IS NOT NULL AND p.review_status = 'APPROVED'
            ORDER BY p.public_at DESC, a.id DESC
            """)
    List<ImageAsset> selectPublicationsByUserId(@Param("userId") long userId);

    @Update("INSERT INTO image_publications (asset_id, review_status, publication_version, review_attempt_count, review_started_at, title, description) VALUES (#{assetId}, 'PENDING', 1, 0, #{now}, #{title}, #{description}) ON DUPLICATE KEY UPDATE review_status = 'PENDING', publication_version = publication_version + 1, review_attempt_count = 0, review_started_at = VALUES(review_started_at), title = VALUES(title), description = VALUES(description)")
    int markPublicationPending(@Param("assetId") long assetId, @Param("title") String title, @Param("description") String description, @Param("now") Instant now);

    @Update("UPDATE image_publications SET public_at = NULL, review_status = 'NONE', review_started_at = NULL, title = NULL, description = NULL, like_count = 0 WHERE asset_id = #{assetId}")
    int withdrawPublication(@Param("assetId") long assetId);

    @Update("UPDATE image_publications SET public_at = #{now}, review_status = 'APPROVED' WHERE asset_id = #{assetId} AND publication_version = #{version} AND review_status = 'PENDING'")
    int approvePublication(@Param("assetId") long assetId, @Param("version") long version, @Param("now") Instant now);

    @Update("UPDATE image_publications SET review_status = 'REJECTED', review_started_at = NULL WHERE asset_id = #{assetId} AND publication_version = #{version} AND review_status = 'PENDING'")
    int rejectPublication(@Param("assetId") long assetId, @Param("version") long version);

    @Update("UPDATE image_publications SET review_attempt_count = review_attempt_count + 1 WHERE asset_id = #{assetId} AND publication_version = #{version} AND review_status = 'PENDING'")
    int incrementPublicationReviewAttemptCount(@Param("assetId") long assetId, @Param("version") long version);

    @Update("UPDATE image_publications SET review_status = 'FAILED', review_started_at = NULL WHERE asset_id = #{assetId} AND publication_version = #{version} AND review_status = 'PENDING'")
    int failPublication(@Param("assetId") long assetId, @Param("version") long version);

    @Update("UPDATE image_publications SET like_count = like_count + #{delta} WHERE asset_id = #{assetId} AND like_count + #{delta} >= 0")
    int changeLikeCount(@Param("assetId") long assetId, @Param("delta") int delta);

    @Update("""
            <script>
            UPDATE image_assets SET deleted_at = #{deletedAt}, oss_cleanup_status = 'PENDING', oss_cleanup_attempt_count = 0,
              oss_cleanup_available_at = #{deletedAt}, oss_cleanup_last_error = NULL
            WHERE user_id = #{userId} AND deleted_at IS NULL AND id IN
            <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
            </script>
            """)
    int markVisibleDeletedByUserIdAndIds(@Param("userId") long userId, @Param("assetIds") List<Long> assetIds, @Param("deletedAt") Instant deletedAt);

    @Select("""
            <script>
            SELECT id FROM image_assets WHERE user_id = #{userId} AND deleted_at IS NULL AND id IN
            <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach> FOR UPDATE
            </script>
            """)
    List<Long> selectVisibleOwnedIdsForUpdate(@Param("userId") long userId, @Param("assetIds") List<Long> assetIds);

    @Update("""
            <script>
            UPDATE image_assets SET is_favorited = #{favorite} WHERE user_id = #{userId} AND deleted_at IS NULL AND id IN
            <foreach collection="assetIds" item="assetId" open="(" separator="," close=")">#{assetId}</foreach>
            </script>
            """)
    int setFavoriteByUserIdAndIds(@Param("userId") long userId, @Param("assetIds") List<Long> assetIds, @Param("favorite") boolean favorite);

    @Select("""
            SELECT a.* FROM image_assets a
            WHERE a.oss_cleanup_status = 'PENDING' AND a.oss_cleanup_available_at <= #{availableAt}
              AND NOT EXISTS (SELECT 1 FROM image_publications p WHERE p.asset_id = a.id AND p.public_at IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM generation_task_input_assets i INNER JOIN generation_tasks t ON t.id = i.task_id
                              WHERE i.asset_id = a.id AND t.status IN ('QUEUED', 'RUNNING', 'TRANSFERRING'))
            ORDER BY a.oss_cleanup_available_at ASC, a.id ASC LIMIT #{limit}
            """)
    List<ImageAsset> selectPendingOssCleanup(@Param("availableAt") Instant availableAt, @Param("limit") int limit);

    @Update("UPDATE image_assets SET oss_cleanup_status = 'SUCCEEDED', oss_cleanup_available_at = NULL, oss_cleanup_last_error = NULL WHERE id = #{assetId} AND oss_cleanup_status = 'PENDING'")
    int markOssCleanupSucceeded(@Param("assetId") long assetId);

    @Update("UPDATE image_assets SET oss_cleanup_attempt_count = oss_cleanup_attempt_count + 1, oss_cleanup_available_at = #{availableAt}, oss_cleanup_last_error = #{lastError} WHERE id = #{assetId} AND oss_cleanup_status = 'PENDING'")
    int rescheduleOssCleanup(@Param("assetId") long assetId, @Param("availableAt") Instant availableAt, @Param("lastError") String lastError);
}
