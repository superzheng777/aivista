package com.superz.aivista.generation.message;

/** TS Agent Worker 对一次 Creation 的确定性最终提交。 */
public record AgentCompletionCommand(int contractVersion, String completionId,
        String creationTaskId, long revision, String outcome, String failureCode, String finalMessage,
        java.util.List<AgentActivityItem> activities) {
}
