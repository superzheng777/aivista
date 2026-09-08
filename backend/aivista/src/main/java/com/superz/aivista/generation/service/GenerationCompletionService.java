package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.message.GenerationCompletionCommand;
import com.superz.aivista.generation.message.GenerationCompletionResponse;
import com.superz.aivista.generation.model.GenerationFailureCode;
import com.superz.aivista.generation.model.GenerationImageObjectKeys;
import com.superz.aivista.generation.model.GenerationTaskStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent HTTP boundary for the single-command TypeScript generation pipeline. */
@Service
public class GenerationCompletionService {
    private static final ZoneId QUOTA_ZONE = ZoneId.of("Asia/Shanghai");
    private final GenerationTaskMapper tasks;
    private final ImageAssetMapper images;
    private final OutboxEventMapper outbox;
    private final UserGenerationDailyUsageMapper usage;
    private final Clock clock;

    public GenerationCompletionService(GenerationTaskMapper tasks, ImageAssetMapper images,
            OutboxEventMapper outbox, UserGenerationDailyUsageMapper usage, Clock clock) {
        this.tasks = tasks;
        this.images = images;
        this.outbox = outbox;
        this.usage = usage;
        this.clock = clock;
    }

    @Transactional
    public GenerationCompletionResponse complete(GenerationCompletionCommand command) {
        validateCommand(command);
        long taskId = Long.parseLong(command.taskId());
        Instant now = clock.instant();
        GenerationTask task = requireTask(taskId);
        if (terminal(task.getStatus())) return response(task);
        if (!"QUEUED".equals(task.getStatus()) || task.getTaskVersion() + 1 != command.taskVersion()) {
            throw new IllegalArgumentException("Generation completion does not own the current task version");
        }
        if ("FAILED".equals(command.outcome())) {
            completeFailure(task, command, now);
        } else {
            completeImages(task, command, now);
        }
        return response(requireTask(taskId));
    }

    private void completeImages(GenerationTask task, GenerationCompletionCommand command, Instant now) {
        int expected = command.expectedImageCount();
        List<GenerationCompletionCommand.CompletedImage> completed = command.images();
        if (expected != task.getRequestedImageCount() || completed.size() > expected) {
            throw new IllegalArgumentException("Generation completion count does not match the task");
        }
        HashSet<Integer> indexes = new HashSet<>();
        for (var image : completed) {
            long fileSize = Long.parseLong(image.fileSize());
            String expectedSuffix = "/" + task.getUserId() + "/tasks/" + task.getId() + "/" + image.sourceIndex();
            if (!indexes.add(image.sourceIndex()) || image.sourceIndex() < 0 || image.sourceIndex() >= expected
                    || image.width() != task.getWidth() || image.height() != task.getHeight()
                    || !"image/png".equals(image.contentType()) || image.objectKey() == null
                    || !image.objectKey().endsWith(expectedSuffix) || fileSize <= 0) {
                throw new IllegalArgumentException("Invalid completed image");
            }
            ImageAsset entity = new ImageAsset();
            entity.setUserId(task.getUserId());
            entity.setOrigin("GENERATED");
            entity.setLifecycle("PERSISTENT");
            entity.setOriginTaskId(task.getId());
            entity.setSourceIndex(image.sourceIndex());
            entity.setObjectKey(image.objectKey());
            entity.setOriginalObjectKey(GenerationImageObjectKeys.fromStoredValue(image.objectKey()).original());
            entity.setContentType(image.contentType());
            entity.setFileSize(fileSize);
            entity.setWidth(image.width());
            entity.setHeight(image.height());
            entity.setCreatedAt(now);
            images.insertSelective(entity);
        }
        String status = completed.size() == expected ? GenerationTaskStatus.SUCCEEDED.name()
                : completed.isEmpty() ? GenerationTaskStatus.FAILED.name()
                : GenerationTaskStatus.PARTIALLY_SUCCEEDED.name();
        String failure = "SUCCEEDED".equals(status) ? null : completed.isEmpty()
                ? GenerationFailureCode.IMAGE_TRANSFER_FAILED.name()
                : GenerationFailureCode.IMAGE_TRANSFER_PARTIAL_FAILURE.name();
        if (tasks.completeQueuedPipeline(task.getId(), task.getTaskVersion(), status, completed.size(), failure,
                command.providerRequestId(), now) != 1) {
            throw new IllegalStateException("Cannot complete generation task " + task.getId());
        }
        outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), task.getTaskVersion() + 1,
                status, retryCount(task), now));
    }

    private void completeFailure(GenerationTask task, GenerationCompletionCommand command, Instant now) {
        GenerationFailureCode failure = GenerationFailureCode.valueOf(command.failureCode());
        boolean refund = refunds(failure);
        if (refund && task.getQuotaRefundedAt() == null
                && usage.refund(task.getUserId(), LocalDate.ofInstant(task.getCreatedAt(), QUOTA_ZONE),
                task.getRequestedImageCount(), now) != 1) {
            throw new IllegalStateException("Generation quota refund record is missing for task " + task.getId());
        }
        if (tasks.failQueuedPipeline(task.getId(), task.getTaskVersion(), failure.name(), command.providerRequestId(),
                refund ? now : null, now) != 1) {
            throw new IllegalStateException("Cannot fail generation task " + task.getId());
        }
        outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), task.getTaskVersion() + 1,
                "FAILED", retryCount(task), now));
    }

    private GenerationCompletionResponse response(GenerationTask task) {
        List<GenerationCompletionResponse.CompletedAsset> assets = images.selectByOriginTaskId(task.getId()).stream()
                .map(asset -> new GenerationCompletionResponse.CompletedAsset(asset.getId().toString(),
                        asset.getSourceIndex(), asset.getWidth(), asset.getHeight()))
                .toList();
        return new GenerationCompletionResponse(task.getId().toString(), task.getStatus(), task.getTaskVersion(), assets);
    }

    private GenerationTask requireTask(long taskId) {
        GenerationTask task = tasks.selectByIdForUpdate(taskId);
        if (task == null) throw new IllegalArgumentException("Generation task does not exist");
        return task;
    }

    private static void validateCommand(GenerationCompletionCommand command) {
        long taskId = Long.parseLong(command.taskId());
        if (command.contractVersion() != 1 || taskId <= 0 || command.taskVersion() < 0
                || command.completionId() == null
                || !command.completionId().equals("generation-" + taskId + "-" + command.taskVersion())
                || !List.of("COMPLETED", "FAILED").contains(command.outcome())) {
            throw new IllegalArgumentException("Invalid generation completion");
        }
        if ("COMPLETED".equals(command.outcome())) {
            if (command.expectedImageCount() == null || command.expectedImageCount() <= 0 || command.images() == null
                    || command.failureCode() != null) {
                throw new IllegalArgumentException("Completed generation payload is incomplete");
            }
        } else if (command.failureCode() == null || command.expectedImageCount() != null || command.images() != null) {
            throw new IllegalArgumentException("Failed generation payload is invalid");
        }
    }

    private static boolean refunds(GenerationFailureCode code) {
        return code == GenerationFailureCode.PROVIDER_CALL_OUTCOME_UNKNOWN
                || code == GenerationFailureCode.PROVIDER_CONNECTION_FAILED
                || code == GenerationFailureCode.PROVIDER_RATE_LIMITED
                || code == GenerationFailureCode.PROVIDER_SERVICE_UNAVAILABLE;
    }

    private static boolean terminal(String status) {
        return "SUCCEEDED".equals(status) || "PARTIALLY_SUCCEEDED".equals(status) || "FAILED".equals(status);
    }

    private static int retryCount(GenerationTask task) {
        return task.getAttemptCount() == null ? 0 : task.getAttemptCount();
    }
}
