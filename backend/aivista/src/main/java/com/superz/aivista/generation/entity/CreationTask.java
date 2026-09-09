package com.superz.aivista.generation.entity;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 一次会话创作轮次；当前只执行普通模式，预留后续 Agent 模式。 */
@Getter
@Setter
@NoArgsConstructor
@Table(value = "creation_tasks", mapperGenerateEnable = false)
public class CreationTask {
    @Id(keyType = KeyType.Auto)
    private Long id;
    private Long userId;
    private Long sessionId;
    private String mode;
    private String status;
    private String failureCode;
    private Long revision;
    private Instant completedAt;
    private Instant createdAt;
    private Instant updatedAt;
}
