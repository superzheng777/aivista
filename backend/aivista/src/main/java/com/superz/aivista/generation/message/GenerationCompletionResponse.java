package com.superz.aivista.generation.message;

import java.util.List;

/** Canonical Java-owned task state returned to the worker after an idempotent commit. */
public record GenerationCompletionResponse(
        String taskId,
        String status,
        int taskVersion,
        List<CompletedAsset> assets) {

    public record CompletedAsset(String assetId, int sourceIndex, int width, int height) {
    }
}
