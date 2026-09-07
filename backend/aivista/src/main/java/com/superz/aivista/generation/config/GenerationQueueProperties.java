package com.superz.aivista.generation.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 图像任务可靠投递的 RabbitMQ 与本地扫描配置。 */
@ConfigurationProperties("app.generation.queue")
public record GenerationQueueProperties(
        boolean enabled,
        String exchange,
        String deadLetterExchange,
        String generationName,
        String generationRoutingKey,
        String transferName,
        String transferRoutingKey,
        String workerResultName,
        String workerResultRoutingKey,
        String workerResultDeadLetterName,
        String workerResultDeadLetterRoutingKey,
        int workerResultConsumerConcurrency,
        Duration dispatcherFixedDelay,
        int dispatcherBatchSize,
        Duration processingLease,
        int deliveryMaxAttempts,
        Duration deliveryRetryDelay,
        Duration queueTimeout,
        Duration queueTimeoutFixedDelay,
        Duration transferTimeout,
        Duration transferTimeoutFixedDelay) {
}
