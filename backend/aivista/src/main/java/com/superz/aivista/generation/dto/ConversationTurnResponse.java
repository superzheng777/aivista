package com.superz.aivista.generation.dto;

/** 一次创作任务及其用户、助手消息和图片生成快照。 */
public record ConversationTurnResponse(
        String creationTaskId,
        String mode,
        String status,
        String failureCode,
        long revision,
        ConversationMessageResponse userMessage,
        ConversationMessageResponse assistantMessage,
        NormalGenerationRequestResponse normalGenerationRequest,
        java.util.List<GenerationTaskSnapshotResponse> generations,
        java.util.List<CreationActivityResponse> activities) {
}
