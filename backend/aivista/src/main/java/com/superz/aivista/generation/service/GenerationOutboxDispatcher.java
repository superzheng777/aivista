package com.superz.aivista.generation.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.generation.config.GenerationQueueProperties;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.message.TaskExecuteMessage;
import com.superz.aivista.generation.message.AgentExecuteMessage;
import com.superz.aivista.generation.model.OutboxEventType;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 将事务已提交的生成 Outbox 命令可靠投递到 RabbitMQ。
 *
 * <p>创建任务时不直接发送 MQ 消息，而是与任务记录同事务写入 Outbox；本服务随后条件领取事件，
 * 并仅在消息被目标队列接收且收到 Publisher Confirm 后标记为 {@code PUBLISHED}。投递失败会有限重试，
 * 重试耗尽后按事件类型收敛仍未被相应消费者领取的任务。</p>
 */
@Service
@ConditionalOnProperty(prefix = "app.generation.queue", name = "enabled", havingValue = "true")
public class GenerationOutboxDispatcher {
    private static final int ERROR_MAX_LENGTH = 512;

    private final OutboxEventMapper outboxEventMapper;
    private final GenerationQueuedTaskFailureService queuedTaskFailureService;
    private final AgentQueuedCreationFailureService queuedCreationFailureService;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final GenerationQueueProperties properties;
    private final Clock clock;

    public GenerationOutboxDispatcher(OutboxEventMapper outboxEventMapper,
            GenerationQueuedTaskFailureService queuedTaskFailureService,
            AgentQueuedCreationFailureService queuedCreationFailureService,
            RabbitTemplate rabbitTemplate, ObjectMapper objectMapper,
            GenerationQueueProperties properties, Clock clock) {
        this.outboxEventMapper = outboxEventMapper;
        this.queuedTaskFailureService = queuedTaskFailureService;
        this.queuedCreationFailureService = queuedCreationFailureService;
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.clock = clock;
    }

    /** 按固定周期扫描并条件领取当前可投递的生成命令。 */
    @Scheduled(fixedDelayString = "${app.generation.queue.dispatcher-fixed-delay}")
    public void dispatchAvailableEvents() {
        Instant now = clock.instant();
        recoverExpiredProcessingEvents(now);
        dispatchAvailableEvents(OutboxEventType.AGENT_EXECUTE, properties.agentRoutingKey(), now);
        dispatchAvailableEvents(OutboxEventType.GENERATION_TASK_EXECUTE, properties.generationRoutingKey(), now);
    }

    /** Reclaims commands left in PROCESSING by an interrupted dispatcher instance. */
    private void recoverExpiredProcessingEvents(Instant now) {
        recoverExpiredProcessingEvents(OutboxEventType.AGENT_EXECUTE, now);
        recoverExpiredProcessingEvents(OutboxEventType.GENERATION_TASK_EXECUTE, now);
    }

    private void recoverExpiredProcessingEvents(OutboxEventType eventType, Instant now) {
        List<OutboxEvent> events = outboxEventMapper.selectProcessingLockedBefore(
                eventType.name(), now.minus(properties.processingLease()), properties.dispatcherBatchSize());
        for (OutboxEvent event : events) {
            handleDeliveryFailure(event, now, "Outbox processing lease expired");
        }
    }

    private void dispatchAvailableEvents(OutboxEventType eventType, String routingKey, Instant now) {
        List<OutboxEvent> events = outboxEventMapper.selectAvailableByEventType(
                eventType.name(), now, properties.dispatcherBatchSize());
        for (OutboxEvent event : events) {
            if (outboxEventMapper.claimPending(event.getId(), now, now) == 1) {
                dispatch(event, routingKey);
            }
        }
    }

    /** 发送最小任务标识消息，并在确认结果返回前保持事件为 PROCESSING。 */
    private void dispatch(OutboxEvent event, String routingKey) {
        Instant now = clock.instant();
        try {
            CorrelationData correlation = new CorrelationData("outbox-" + event.getId());
            rabbitTemplate.send(properties.exchange(), routingKey, taskMessage(event), correlation);
            CorrelationData.Confirm confirm = correlation.getFuture()
                    .get(10, TimeUnit.SECONDS);
            if (!confirm.ack()) {
                throw new IllegalStateException("RabbitMQ publisher confirm rejected: " + confirm.reason());
            }
            if (correlation.getReturned() != null) {
                throw new IllegalStateException("RabbitMQ message was not routed to a queue");
            }
            outboxEventMapper.markPublished(event.getId(), now);
        } catch (Exception exception) {
            handleDeliveryFailure(event, now, safeError(exception));
        }
    }

    private Message taskMessage(OutboxEvent event) throws JsonProcessingException {
        Object command = switch (OutboxEventType.valueOf(event.getEventType())) {
            case AGENT_EXECUTE -> new AgentExecuteMessage(
                    event.getId(), event.getAggregateId(), event.getAggregateVersion());
            case GENERATION_TASK_EXECUTE -> new TaskExecuteMessage(event.getId(), event.getAggregateId(),
                    Math.toIntExact(event.getAggregateVersion()));
            default -> throw new IllegalArgumentException("Unsupported command event " + event.getEventType());
        };
        byte[] body = objectMapper.writeValueAsBytes(command);
        return MessageBuilder.withBody(body)
                .setContentType(MessageProperties.CONTENT_TYPE_JSON)
                .setContentEncoding(StandardCharsets.UTF_8.name())
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
                .build();
    }

    /** 对可恢复故障重新排期；超过重试上限后收敛事件及其原始排队任务。 */
    private void handleDeliveryFailure(OutboxEvent event, Instant now, String error) {
        int retries = event.getRetryCount() + 1;
        if (retries <= properties.deliveryMaxAttempts()) {
            outboxEventMapper.reschedule(event.getId(), retries,
                    now.plus(properties.deliveryRetryDelay().multipliedBy(retries)), error);
            return;
        }
        if (OutboxEventType.AGENT_EXECUTE.name().equals(event.getEventType())) {
            queuedCreationFailureService.failDelivery(event.getId(), event.getAggregateId(),
                    event.getAggregateVersion(), now, error);
        } else {
            queuedTaskFailureService.failDelivery(event.getId(), event.getAggregateId(),
                    Math.toIntExact(event.getAggregateVersion()), now, error);
        }
    }


    private static String safeError(Exception exception) {
        String value = exception.getClass().getSimpleName() + ": " + exception.getMessage();
        return value.length() <= ERROR_MAX_LENGTH ? value : value.substring(0, ERROR_MAX_LENGTH);
    }

}
