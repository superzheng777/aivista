package com.superz.aivista.generation.message;

import java.util.List;

/** One terminal result submitted after the TypeScript worker finishes provider and OSS work. */
public record GenerationCompletionCommand(
        int contractVersion,
        String completionId,
        String taskId,
        int taskVersion,
        String outcome,
        String providerRequestId,
        Integer expectedImageCount,
        String failureCode,
        List<CompletedImage> images) {

    public record CompletedImage(
            int sourceIndex,
            String objectKey,
            String contentType,
            String fileSize,
            int width,
            int height) {
    }
}
