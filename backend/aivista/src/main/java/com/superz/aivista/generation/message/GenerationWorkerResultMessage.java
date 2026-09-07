package com.superz.aivista.generation.message;

import java.util.List;

/** Versioned result emitted by the TypeScript generation worker. */
public record GenerationWorkerResultMessage(
        int contractVersion,
        String resultId,
        String phase,
        String outcome,
        String taskId,
        int taskVersion,
        String providerRequestId,
        String providerResultSnapshot,
        Integer declaredWidth,
        Integer declaredHeight,
        Integer expectedImageCount,
        String failureCode,
        List<TransferredImage> images) {

    public record TransferredImage(
            int sourceIndex,
            String objectKey,
            String fileSize,
            int width,
            int height) { }
}
