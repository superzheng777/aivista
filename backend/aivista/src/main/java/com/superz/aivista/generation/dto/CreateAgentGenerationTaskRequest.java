package com.superz.aivista.generation.dto;

import java.util.List;

/** One generation Tool invocation inside an already-created Agent Creation. */
public record CreateAgentGenerationTaskRequest(
        String operation,
        String prompt,
        String negativePrompt,
        String aspectRatio,
        Boolean promptExtend,
        Integer imageCount,
        List<String> inputAssetIds) {
}
