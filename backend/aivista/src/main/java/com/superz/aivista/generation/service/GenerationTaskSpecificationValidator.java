package com.superz.aivista.generation.service;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.config.GenerationTaskProperties;
import java.util.HashSet;
import java.util.List;
import org.springframework.stereotype.Component;

/** Normalizes and validates the shared generation contract for browser and Agent callers. */
@Component
public class GenerationTaskSpecificationValidator {
    private final GenerationTaskProperties properties;

    public GenerationTaskSpecificationValidator(GenerationTaskProperties properties) {
        this.properties = properties;
    }

    public GenerationTaskSpecification validate(String prompt, String negativePrompt,
            String aspectRatio, Boolean promptExtend, Integer imageCount, List<String> inputAssetIds) {
        GenerationPromptValidator.requireValidPrompt(
                "prompt", prompt, properties.maxPromptCodePoints(), true);
        String normalizedNegativePrompt = negativePrompt == null || negativePrompt.isBlank()
                ? null : negativePrompt;
        GenerationPromptValidator.requireValidPrompt(
                "negativePrompt", normalizedNegativePrompt,
                properties.maxNegativePromptCodePoints(), false);
        String normalizedAspectRatio = aspectRatio == null ? null : aspectRatio.trim();
        if (normalizedAspectRatio == null || !properties.aspectRatios().containsKey(normalizedAspectRatio)) {
            throw invalid("aspectRatio：不受当前模型支持");
        }
        if (imageCount == null || imageCount < properties.minImageCount()
                || imageCount > properties.maxImageCount()) {
            throw invalid("imageCount：不在当前模型允许范围内");
        }
        List<Long> normalizedInputAssetIds = normalizeInputAssetIds(inputAssetIds);
        return new GenerationTaskSpecification(prompt, normalizedNegativePrompt, normalizedAspectRatio,
                promptExtend == null || promptExtend, imageCount, normalizedInputAssetIds);
    }

    public String validateAgentPrompt(String prompt) {
        GenerationPromptValidator.requireValidPrompt(
                "prompt", prompt, properties.maxPromptCodePoints(), true);
        return prompt;
    }

    public static List<Long> normalizeInputAssetIds(List<String> values) {
        if (values == null || values.isEmpty()) return List.of();
        if (values.size() > 3) throw invalid("inputAssetIds：最多只能选择3张参考图片");
        List<Long> result = values.stream().map(GenerationTaskSpecificationValidator::parseAssetId).toList();
        if (new HashSet<>(result).size() != result.size()) {
            throw invalid("inputAssetIds：不能包含重复图片");
        }
        return result;
    }

    private static long parseAssetId(String value) {
        try {
            long id = Long.parseLong(value);
            if (id <= 0 || !Long.toString(id).equals(value)) {
                throw invalid("inputAssetIds：必须是正整数ID");
            }
            return id;
        } catch (NumberFormatException exception) {
            throw invalid("inputAssetIds：必须是正整数ID");
        }
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.VALIDATION_ERROR, message);
    }
}
