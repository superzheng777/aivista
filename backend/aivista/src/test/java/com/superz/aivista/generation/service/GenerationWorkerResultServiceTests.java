package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.config.GenerationBailianProperties;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.message.GenerationWorkerResultMessage;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GenerationWorkerResultServiceTests {
    private static final Instant NOW = Instant.parse("2026-09-07T00:00:00Z");
    private final GenerationTaskMapper tasks = mock(GenerationTaskMapper.class);
    private final ImageAssetMapper images = mock(ImageAssetMapper.class);
    private final OutboxEventMapper outbox = mock(OutboxEventMapper.class);
    private final UserGenerationDailyUsageMapper usage = mock(UserGenerationDailyUsageMapper.class);
    private final GenerationWorkerResultService service = new GenerationWorkerResultService(tasks, images, outbox,
            usage, new GenerationBailianProperties(3), Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void providerSuccessMovesQueuedTaskThroughJavaOwnedRunningAndTransferStates() {
        GenerationTask task = task("QUEUED", 0);
        when(tasks.selectByIdForUpdate(101L)).thenReturn(task);
        when(tasks.claimQueuedForExecution(101L, 0, NOW)).thenReturn(1);
        when(tasks.markProviderCallStarted(101L, NOW)).thenReturn(1);
        when(tasks.markReadyForTransfer(101L, 1, "request-1", "{}", NOW)).thenReturn(1);

        service.apply(result("PROVIDER", "SUCCEEDED", 0, "request-1", "{}", 1, List.of(), null));

        verify(tasks).markReadyForTransfer(101L, 1, "request-1", "{}", NOW);
        ArgumentCaptor<OutboxEvent> events = ArgumentCaptor.forClass(OutboxEvent.class);
        verify(outbox, times(3)).insertSelective(events.capture());
        assertThat(events.getAllValues()).extracting(OutboxEvent::getEventType)
                .containsExactly("GENERATION_TASK_STATUS_CHANGED", "GENERATION_IMAGE_TRANSFER",
                        "GENERATION_TASK_STATUS_CHANGED");
    }

    @Test
    void transferSuccessPersistsAssetsAndFinalStateOnlyInJava() {
        GenerationTask task = task("TRANSFERRING", 2);
        when(tasks.selectByIdForUpdate(101L)).thenReturn(task);
        when(tasks.markTransferStarted(101L, 2, NOW)).thenReturn(1);
        when(tasks.completeTransferring(101L, 2, "SUCCEEDED", 1, null, NOW)).thenReturn(1);
        var transferred = new GenerationWorkerResultMessage.TransferredImage(
                0, "users/7/tasks/101/0", "12345", 2048, 2048);

        service.apply(result("TRANSFER", "SUCCEEDED", 2, null, null, 1, List.of(transferred), null));

        ArgumentCaptor<ImageAsset> asset = ArgumentCaptor.forClass(ImageAsset.class);
        verify(images).insertSelective(asset.capture());
        assertThat(asset.getValue().getOriginalObjectKey()).isEqualTo("users/7/tasks/101/0/original.png");
        verify(tasks).completeTransferring(101L, 2, "SUCCEEDED", 1, null, NOW);
    }

    private static GenerationWorkerResultMessage result(String phase, String outcome, int version,
            String requestId, String snapshot, Integer expected, List<GenerationWorkerResultMessage.TransferredImage> images,
            String failureCode) {
        return new GenerationWorkerResultMessage(1, "result", phase, outcome, "101", version,
                requestId, snapshot, 2048, 2048, expected, failureCode, images);
    }

    private static GenerationTask task(String status, int version) {
        GenerationTask task = new GenerationTask();
        task.setId(101L); task.setUserId(7L); task.setStatus(status); task.setTaskVersion(version);
        task.setAttemptCount(0); task.setWidth(2048); task.setHeight(2048); task.setRequestedImageCount(1);
        task.setCreatedAt(NOW); return task;
    }
}
