package com.superz.aivista.generation.model;

/** 普通文生图任务的持久化状态。 */
public enum GenerationTaskStatus {
    /** 已受理，尚未由工作器提交终态。 */
    QUEUED,
    SUCCEEDED,
    PARTIALLY_SUCCEEDED,
    FAILED
}
