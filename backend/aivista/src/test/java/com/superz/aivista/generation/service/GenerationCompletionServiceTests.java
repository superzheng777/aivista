package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.message.GenerationCompletionCommand;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class GenerationCompletionServiceTests {
    private static final Instant NOW = Instant.parse("2026-09-08T00:00:00Z");
    private final GenerationTaskMapper tasks = mock(GenerationTaskMapper.class);
    private final ImageAssetMapper images = mock(ImageAssetMapper.class);
    private final OutboxEventMapper outbox = mock(OutboxEventMapper.class);
    private final UserGenerationDailyUsageMapper usage = mock(UserGenerationDailyUsageMapper.class);
    private final GenerationCompletionService service = new GenerationCompletionService(tasks, images, outbox, usage,
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void completionCommitsImagesAndDerivesTheFinalStatus() {
        GenerationTask queued = task("QUEUED", 0);
        GenerationTask succeeded = task("SUCCEEDED", 1);
        when(tasks.selectByIdForUpdate(101L)).thenReturn(queued, succeeded);
        when(tasks.completeQueuedPipeline(101L, 0, "SUCCEEDED", 1, null, "provider-1", NOW)).thenReturn(1);
        when(images.selectByOriginTaskId(101L)).thenReturn(List.of());
        var image = new GenerationCompletionCommand.CompletedImage(0, "users/7/tasks/101/0", "image/png",
                "12345", 2048, 2048);

        var response = service.complete(new GenerationCompletionCommand(1, "generation-101-1", "101", 1,
                "COMPLETED", "provider-1", 1, null, List.of(image)));

        assertThat(response.status()).isEqualTo("SUCCEEDED");
        verify(images).insertSelective(org.mockito.ArgumentMatchers.argThat(asset ->
                "users/7/tasks/101/0/original.png".equals(asset.getOriginalObjectKey())));
        verify(tasks).completeQueuedPipeline(101L, 0, "SUCCEEDED", 1, null, "provider-1", NOW);
    }

    @Test
    void terminalTaskMakesCompletionAnIdempotentRead() {
        GenerationTask succeeded = task("SUCCEEDED", 2);
        when(tasks.selectByIdForUpdate(101L)).thenReturn(succeeded);
        when(images.selectByOriginTaskId(101L)).thenReturn(List.of());

        var response = service.complete(new GenerationCompletionCommand(1, "generation-101-1", "101", 1,
                "FAILED", null, null, "PROVIDER_CONFIGURATION_ERROR", null));

        assertThat(response.status()).isEqualTo("SUCCEEDED");
        verify(tasks, never()).failQueuedPipeline(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    private static GenerationTask task(String status, int version) {
        GenerationTask task = new GenerationTask();
        task.setId(101L);
        task.setUserId(7L);
        task.setStatus(status);
        task.setTaskVersion(version);
        task.setAttemptCount(0);
        task.setWidth(2048);
        task.setHeight(2048);
        task.setRequestedImageCount(1);
        task.setCreatedAt(NOW);
        return task;
    }
}
