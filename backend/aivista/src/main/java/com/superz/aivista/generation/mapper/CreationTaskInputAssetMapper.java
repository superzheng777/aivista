package com.superz.aivista.generation.mapper;

import com.mybatisflex.core.BaseMapper;
import com.superz.aivista.generation.entity.CreationTaskInputAsset;
import java.util.List;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** 创作轮次输入图片数据访问接口。 */
public interface CreationTaskInputAssetMapper extends BaseMapper<CreationTaskInputAsset> {
    @Select("""
            SELECT image_asset_id
            FROM creation_task_input_assets
            WHERE creation_task_id = #{creationTaskId}
            ORDER BY source_index
            """)
    List<Long> selectAssetIdsByCreationTaskId(@Param("creationTaskId") long creationTaskId);
}
