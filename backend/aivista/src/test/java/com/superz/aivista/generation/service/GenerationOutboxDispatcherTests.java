package com.superz.aivista.generation.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.generation.config.GenerationQueueProperties;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

class GenerationOutboxDispatcherTests {
    private static final Instant NOW = Instant.parse("2026-08-20T12:00:00Z");

    @Test
    void routesGenerationCommandsThroughTheConfiguredDirectExchangeKey() {
        OutboxEventMapper mapper = mock(OutboxEventMapper.class);
        RabbitTemplate template = mock(RabbitTemplate.class);
        OutboxEvent generation = event(11L, "GENERATION_TASK_EXECUTE", 1L);
        when(mapper.selectAvailableByEventType("GENERATION_TASK_EXECUTE", NOW, 20))
                .thenReturn(List.of(generation));
        when(mapper.claimPending(11L, NOW, NOW)).thenReturn(1);
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(3);
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(template).send(any(String.class), any(String.class), any(Message.class), any(CorrelationData.class));

        new GenerationOutboxDispatcher(mapper, mock(GenerationQueuedTaskFailureService.class),
                template, new ObjectMapper(), properties(),
                Clock.fixed(NOW, ZoneOffset.UTC)).dispatchAvailableEvents();

        verify(template).send(eq("aivista.generation.commands"), eq("generation.task.execute"),
                any(Message.class), any(CorrelationData.class));
        verify(mapper).markPublished(11L, NOW);
    }

    @Test
    void reschedulesExpiredProcessingCommandsBeforeDispatchingNewCommands() {
        OutboxEventMapper mapper = mock(OutboxEventMapper.class);
        OutboxEvent stale = event(11L, "GENERATION_TASK_EXECUTE", 1L);
        stale.setRetryCount(1);
        when(mapper.selectProcessingLockedBefore("GENERATION_TASK_EXECUTE", NOW.minusSeconds(30), 20))
                .thenReturn(List.of(stale));
        when(mapper.selectAvailableByEventType(any(String.class), eq(NOW), eq(20))).thenReturn(List.of());

        new GenerationOutboxDispatcher(mapper, mock(GenerationQueuedTaskFailureService.class),
                mock(RabbitTemplate.class), new ObjectMapper(),
                properties(), Clock.fixed(NOW, ZoneOffset.UTC)).dispatchAvailableEvents();

        verify(mapper).reschedule(11L, 2, NOW.plusSeconds(10), "Outbox processing lease expired");
    }

    @Test
    void failsExpiredProcessingCommandAfterDeliveryRetriesAreExhausted() {
        OutboxEventMapper mapper = mock(OutboxEventMapper.class);
        GenerationQueuedTaskFailureService failures = mock(GenerationQueuedTaskFailureService.class);
        OutboxEvent stale = event(11L, "GENERATION_TASK_EXECUTE", 1L);
        stale.setRetryCount(5);
        when(mapper.selectProcessingLockedBefore("GENERATION_TASK_EXECUTE", NOW.minusSeconds(30), 20))
                .thenReturn(List.of(stale));
        when(mapper.selectAvailableByEventType(any(String.class), eq(NOW), eq(20))).thenReturn(List.of());

        new GenerationOutboxDispatcher(mapper, failures, mock(RabbitTemplate.class),
                new ObjectMapper(), properties(), Clock.fixed(NOW, ZoneOffset.UTC))
                .dispatchAvailableEvents();

        verify(failures).failDelivery(11L, 301L, 1, NOW, "Outbox processing lease expired");
        verify(mapper, never()).reschedule(eq(11L), any(Integer.class), any(), any(String.class));
    }

    private static OutboxEvent event(long id, String type, long version) {
        OutboxEvent event = new OutboxEvent();
        event.setId(id);
        event.setEventType(type);
        event.setAggregateId(301L);
        event.setAggregateVersion(version);
        event.setRetryCount(0);
        return event;
    }

    static GenerationQueueProperties properties() {
        return new GenerationQueueProperties(true, "aivista.generation.commands",
                "generation.task.execute", "generation.task.execute",
                Duration.ofSeconds(1), 20, Duration.ofSeconds(30), 5, Duration.ofSeconds(5),
                Duration.ofMinutes(3), Duration.ofSeconds(30));
    }
}
