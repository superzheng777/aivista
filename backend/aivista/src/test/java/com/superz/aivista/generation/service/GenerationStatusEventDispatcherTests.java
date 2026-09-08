package com.superz.aivista.generation.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.config.GenerationSseProperties;
import com.superz.aivista.generation.config.GenerationBailianProperties;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.event.GenerationTaskStatusEvent;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class GenerationStatusEventDispatcherTests {
    private static final Instant NOW = Instant.parse("2026-07-30T03:00:00Z");

    @Test
    void publishesMatchingCurrentTaskStateAndMarksOutboxPublished() {
        OutboxEventMapper outboxMapper = mock(OutboxEventMapper.class);
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        GenerationSseConnectionService connections = mock(GenerationSseConnectionService.class);
        OutboxEvent event = event(99L, 301L, 4);
        GenerationTask task = task(301L, 7L, 201L, 4, "FAILED");
        when(outboxMapper.selectAvailableByEventType("GENERATION_TASK_STATUS_CHANGED", NOW, 100)).thenReturn(List.of(event));
        when(outboxMapper.claimPending(99L, NOW, NOW)).thenReturn(1);
        when(taskMapper.selectStatusEventTasksByIds(List.of(301L))).thenReturn(List.of(task));

        dispatcher(outboxMapper, taskMapper, connections).dispatchAvailableEvents();

        verify(connections).publish(7L, 99L,
                new GenerationTaskStatusEvent("201", "301", 4, "FAILED", 1, 3));
        verify(outboxMapper).markPublishedBatch(List.of(99L), NOW);
    }

    @Test
    void publishesStateSnapshotEvenWhenTaskHasAlreadyAdvanced() {
        OutboxEventMapper outboxMapper = mock(OutboxEventMapper.class);
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        GenerationSseConnectionService connections = mock(GenerationSseConnectionService.class);
        OutboxEvent event = event(99L, 301L, 0);
        when(outboxMapper.selectAvailableByEventType("GENERATION_TASK_STATUS_CHANGED", NOW, 100)).thenReturn(List.of(event));
        when(outboxMapper.claimPending(99L, NOW, NOW)).thenReturn(1);
        when(taskMapper.selectStatusEventTasksByIds(List.of(301L)))
                .thenReturn(List.of(task(301L, 7L, 201L, 4, "FAILED")));

        dispatcher(outboxMapper, taskMapper, connections).dispatchAvailableEvents();

        verify(connections).publish(7L, 99L,
                new GenerationTaskStatusEvent("201", "301", 0, "QUEUED", 1, 3));
        verify(outboxMapper).markPublishedBatch(List.of(99L), NOW);
    }

    private static GenerationStatusEventDispatcher dispatcher(OutboxEventMapper outboxMapper,
            GenerationTaskMapper taskMapper, GenerationSseConnectionService connections) {
        return new GenerationStatusEventDispatcher(outboxMapper, taskMapper, connections,
                new GenerationSseProperties(3, 1000, Duration.ofSeconds(15), Duration.ofSeconds(1), 100,
                        Duration.ofSeconds(30)),
                new GenerationBailianProperties(3),
                Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());
    }

    @Test
    void requeuesExpiredProcessingEventBeforeDispatchingAvailableEvents() {
        OutboxEventMapper outboxMapper = mock(OutboxEventMapper.class);
        OutboxEvent staleEvent = event(98L, 301L, 0);
        staleEvent.setRetryCount(2);
        when(outboxMapper.selectProcessingLockedBefore("GENERATION_TASK_STATUS_CHANGED", NOW.minusSeconds(30), 100))
                .thenReturn(List.of(staleEvent));

        dispatcher(outboxMapper, mock(GenerationTaskMapper.class), mock(GenerationSseConnectionService.class))
                .dispatchAvailableEvents();

        verify(outboxMapper).rescheduleBatch(List.of(staleEvent), "SSE status event processing lease expired");
        org.assertj.core.api.Assertions.assertThat(staleEvent.getRetryCount()).isEqualTo(3);
        org.assertj.core.api.Assertions.assertThat(staleEvent.getAvailableAt()).isEqualTo(NOW);
    }

    private static OutboxEvent event(long id, long taskId, int taskVersion) {
        OutboxEvent event = new OutboxEvent();
        event.setId(id);
        event.setAggregateType("GENERATION_TASK");
        event.setAggregateId(taskId);
        event.setAggregateVersion((long) taskVersion);
        event.setPayloadJson("{\"status\":\"" + (taskVersion == 0 ? "QUEUED" : "FAILED")
                + "\",\"modelRetryCount\":1}");
        return event;
    }

    private static GenerationTask task(long id, long userId, long sessionId, int taskVersion, String status) {
        GenerationTask task = new GenerationTask();
        task.setId(id);
        task.setUserId(userId);
        task.setSessionId(sessionId);
        task.setTaskVersion(taskVersion);
        task.setStatus(status);
        return task;
    }
}
