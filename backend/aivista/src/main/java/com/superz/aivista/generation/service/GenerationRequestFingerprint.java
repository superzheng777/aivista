package com.superz.aivista.generation.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

/** 以固定字段顺序和长度前缀计算创建请求的稳定 SHA-256 指纹。 */
final class GenerationRequestFingerprint {
    private GenerationRequestFingerprint() {
    }

    static String sha256(long userId, String sessionIdentity, String prompt,
            String negativePrompt, String aspectRatio, boolean promptExtend, int imageCount, List<Long> inputAssetIds) {
        String canonical = field("userId", Long.toString(userId))
                + field("session", sessionIdentity)
                + field("prompt", prompt)
                + field("negativePrompt", negativePrompt == null ? "" : negativePrompt)
                + field("aspectRatio", aspectRatio)
                + field("promptExtend", Boolean.toString(promptExtend))
                + field("imageCount", Integer.toString(imageCount))
                + field("inputAssetIds", inputAssetIds.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(",")));
        return digest(canonical);
    }

    static String sha256Agent(long userId, String sessionIdentity, String prompt, List<Long> inputAssetIds) {
        return digest(field("userId", Long.toString(userId))
                + field("session", sessionIdentity)
                + field("prompt", prompt)
                + field("inputAssetIds", inputAssetIds.stream().map(String::valueOf)
                        .collect(java.util.stream.Collectors.joining(","))));
    }

    private static String digest(String canonical) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", exception);
        }
    }

    static String sha256(long userId, String sessionIdentity, String prompt,
            String negativePrompt, String aspectRatio, boolean promptExtend, int imageCount) {
        return sha256(userId, sessionIdentity, prompt, negativePrompt, aspectRatio, promptExtend, imageCount, List.of());
    }

    private static String field(String name, String value) {
        // 使用 UTF-8 字节长度而不是分隔符切分，避免提示词本身含有分隔符时产生歧义。
        return name + ':' + value.getBytes(StandardCharsets.UTF_8).length + ':' + value + '\n';
    }
}
