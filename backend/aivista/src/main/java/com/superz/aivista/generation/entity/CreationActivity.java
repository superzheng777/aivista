package com.superz.aivista.generation.entity;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 用户刷新后仍可恢复的 Agent 稳定步骤，不是 Pi Trace。 */
@Getter
@Setter
@NoArgsConstructor
@Table(value = "creation_activities", mapperGenerateEnable = false)
public class CreationActivity {
    @Id(keyType = KeyType.Auto)
    private Long id;
    private Long creationTaskId;
    private Integer sequenceNo;
    private String activityType;
    private String activityKey;
    private String state;
    private String content;
    private String toolName;
    private Long generationTaskId;
    private Instant startedAt;
    private Instant completedAt;
}
