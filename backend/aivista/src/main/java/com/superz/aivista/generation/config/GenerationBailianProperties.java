package com.superz.aivista.generation.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Java Core 处理 TypeScript Worker 失败结果时使用的重试上限。 */
@ConfigurationProperties("app.generation.bailian")
public record GenerationBailianProperties(
        int maxRetries) {

    public GenerationBailianProperties {
        requirePositive("app.generation.bailian.max-retries", maxRetries);
    }

    private static void requirePositive(String name, int value) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
