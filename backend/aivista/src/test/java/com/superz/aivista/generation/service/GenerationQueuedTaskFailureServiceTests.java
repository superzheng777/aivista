package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.model.GenerationFailureCode;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GenerationQueuedTaskFailureServiceTests {
    private static final Instant NOW = Instant.parse("2026-07-29T01:00:00Z");

    private final GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
    private final UserGenerationDailyUsageMapper dailyUsageMapper = mock(UserGenerationDailyUsageMapper.class);
    private final OutboxEventMapper outboxEventMapper = mock(OutboxEventMapper.class);
    private GenerationQueuedTaskFailureService service;

    @BeforeEach
    void setUp() {
        service = new GenerationQueuedTaskFailureService(taskMapper, dailyUsageMapper, outboxEventMapper);
    }

    @Test
    void failsQueuedTaskAndRefundsItsOriginalBusinessDayQuota() {
        GenerationTask task = queuedTask();
        task.setCreatedAt(Instant.parse("2026-07-28T16:30:00Z"));
        when(taskMapper.selectByIdForUpdate(11L)).thenReturn(task);
        when(taskMapper.failQueued(anyLong(), anyInt(), any(), any(), any())).thenReturn(1);
        when(dailyUsageMapper.refund(anyLong(), any(), anyInt(), any())).thenReturn(1);

        boolean changed = service.failIfStillQueued(11L, GenerationFailureCode.QUEUE_TIMEOUT, NOW);

        assertThat(changed).isTrue();
        verify(taskMapper).failQueued(11L, 3, "QUEUE_TIMEOUT", NOW, NOW);
        verify(dailyUsageMapper).refund(7L, java.time.LocalDate.of(2026, 7, 29), 2, NOW);
        ArgumentCaptor<OutboxEvent> event = ArgumentCaptor.forClass(OutboxEvent.class);
        verify(outboxEventMapper).insertSelective(event.capture());
        assertThat(event.getValue().getAggregateVersion()).isEqualTo(4L);
        assertThat(event.getValue().getPayloadJson())
                .isEqualTo("{\"status\":\"FAILED\",\"modelRetryCount\":0}");
    }

    @Test
    void leavesTerminalTaskUntouched() {
        GenerationTask task = queuedTask();
        task.setStatus("SUCCEEDED");
        when(taskMapper.selectByIdForUpdate(11L)).thenReturn(task);

        boolean changed = service.failIfStillQueued(11L, GenerationFailureCode.QUEUE_TIMEOUT, NOW);

        assertThat(changed).isFalse();
        verify(taskMapper, never()).failQueued(anyLong(), anyInt(), any(), any(), any());
        verify(dailyUsageMapper, never()).refund(anyLong(), any(), anyInt(), any());
    }

    @Test
    void marksEventFailedBeforeSettlingQueuedTask() {
        GenerationTask task = queuedTask();
        when(outboxEventMapper.markFailed(99L, "broker down")).thenReturn(1);
        when(taskMapper.selectByIdForUpdate(11L)).thenReturn(task);
        when(taskMapper.failQueued(anyLong(), anyInt(), any(), any(), any())).thenReturn(1);
        when(dailyUsageMapper.refund(anyLong(), any(), anyInt(), any())).thenReturn(1);

        service.failDelivery(99L, 11L, 3, NOW, "broker down");

        verify(outboxEventMapper).markFailed(99L, "broker down");
        verify(taskMapper).failQueued(11L, 3, "QUEUE_DELIVERY_FAILED", NOW, NOW);
    }

    private static GenerationTask queuedTask() {
        GenerationTask task = new GenerationTask();
        task.setId(11L);
        task.setUserId(7L);
        task.setStatus("QUEUED");
        task.setTaskVersion(3);
        task.setRequestedImageCount(2);
        task.setCreatedAt(Instant.parse("2026-07-29T01:00:00Z"));
        return task;
    }
}
