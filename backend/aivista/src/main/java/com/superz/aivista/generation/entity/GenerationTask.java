package com.superz.aivista.generation.entity;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 异步图像生成任务的权威状态记录。 */
@Getter
@Setter
@NoArgsConstructor
@Table(value = "generation_tasks", mapperGenerateEnable = false)
public class GenerationTask {
    @Id(keyType = KeyType.Auto)
    private Long id;
    private Long userId;
    private Long sessionId;
    /** 所属通用创作轮次；普通与未来 Agent 模式共享。 */
    private Long creationTaskId;
    /** TEXT_TO_IMAGE 或 IMAGE_TO_IMAGE，由任务输入资产数量派生。 */
    private String operation;
    private String model;
    /**
     * QUEUED、SUCCEEDED、PARTIALLY_SUCCEEDED 或 FAILED。
     * 仅允许由任务状态机按既定方向迁移。
     */
    private String status;
    /** 每次状态变化递增，供条件更新和 SSE 客户端去重使用。 */
    private Integer taskVersion;
    /** 仅统计允许自动重试的服务商调用次数。 */
    private Integer attemptCount;
    /** 本次任务实际发送给模型的提示词快照，仅保留给服务端追溯。 */
    private String finalPrompt;
    private String finalNegativePrompt;
    private Integer width;
    private Integer height;
    private Boolean promptExtend;
    private Integer requestedImageCount;
    private Integer completedImageCount;
    /** 平台侧失败返还每日额度后写入，保证同一任务最多返还一次。 */
    private Instant quotaRefundedAt;
    private String providerRequestId;
    /** 仅在 FAILED 或 PARTIALLY_SUCCEEDED 时保存稳定失败分类。 */
    private String failureCode;
    private Instant createdAt;
    private Instant updatedAt;
    private Instant completedAt;
}
