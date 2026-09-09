package com.superz.aivista.generation.message;

/** Java 已提交的 Agent Creation 权威终态。 */
public record AgentCompletionResponse(String creationTaskId, String status,
        long revision, String failureCode, String finalMessage) {
}
