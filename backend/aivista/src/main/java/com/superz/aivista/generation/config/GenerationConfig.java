package com.superz.aivista.generation.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 注册当前阶段需要的图像生成配置绑定。
 * 百炼、OSS 与消息队列配置由对应阶段的客户端和服务使用。
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties({
        GenerationConsentProperties.class,
        GenerationTaskProperties.class,
        GenerationSseProperties.class,
        GenerationQueueProperties.class,
        OutboxCleanupProperties.class,
        GenerationAssetCleanupProperties.class,
        GenerationAssetUploadProperties.class,
        GenerationBailianProperties.class,
        GenerationOssProperties.class,
        GenerationWorkerApiProperties.class
})
public class GenerationConfig {

    /** 生成模块的响应快照与队列消息共用同一 JSON 序列化器。 */
    @Bean
    ObjectMapper generationObjectMapper() {
        return new ObjectMapper();
    }
}
