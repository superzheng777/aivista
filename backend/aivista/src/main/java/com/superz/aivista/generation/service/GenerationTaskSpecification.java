package com.superz.aivista.generation.service;

import java.util.List;

/** Validated, caller-independent input for creating one image generation task. */
public record GenerationTaskSpecification(
        String prompt,
        String negativePrompt,
        String aspectRatio,
        boolean promptExtend,
        int imageCount,
        List<Long> inputAssetIds) {
}
