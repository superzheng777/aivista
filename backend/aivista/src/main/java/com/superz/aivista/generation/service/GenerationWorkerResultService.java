package com.superz.aivista.generation.service;

import com.superz.aivista.generation.config.GenerationBailianProperties;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.message.GenerationWorkerResultMessage;
import com.superz.aivista.generation.model.GenerationFailureCode;
import com.superz.aivista.generation.model.GenerationImageObjectKeys;
import com.superz.aivista.generation.model.GenerationTaskStatus;
import com.superz.aivista.generation.model.OutboxEventType;
import com.superz.aivista.generation.model.OutboxStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applies TypeScript worker results while keeping all core writes in Java. */
@Service
public class GenerationWorkerResultService {
    private static final ZoneId QUOTA_ZONE = ZoneId.of("Asia/Shanghai");
    private final GenerationTaskMapper tasks;
    private final ImageAssetMapper images;
    private final OutboxEventMapper outbox;
    private final UserGenerationDailyUsageMapper usage;
    private final GenerationBailianProperties bailian;
    private final Clock clock;

    public GenerationWorkerResultService(GenerationTaskMapper tasks, ImageAssetMapper images,
            OutboxEventMapper outbox, UserGenerationDailyUsageMapper usage,
            GenerationBailianProperties bailian, Clock clock) {
        this.tasks = tasks;
        this.images = images;
        this.outbox = outbox;
        this.usage = usage;
        this.bailian = bailian;
        this.clock = clock;
    }

    @Transactional
    public void apply(GenerationWorkerResultMessage result) {
        long taskId = Long.parseLong(result.taskId());
        if ("PROVIDER".equals(result.phase())) {
            applyProvider(taskId, result);
        } else {
            applyTransfer(taskId, result);
        }
    }

    private void applyProvider(long taskId, GenerationWorkerResultMessage result) {
        Instant now = clock.instant();
        GenerationTask task = tasks.selectByIdForUpdate(taskId);
        if (task == null || terminal(task.getStatus())) return;
        if ("QUEUED".equals(task.getStatus()) && task.getTaskVersion() == result.taskVersion()) {
            if (tasks.claimQueuedForExecution(taskId, result.taskVersion(), now) != 1) return;
            task.setStatus("RUNNING");
            task.setTaskVersion(result.taskVersion() + 1);
            task.setStartedAt(now);
            outbox.insertSelective(GenerationStatusOutboxEvent.create(taskId, task.getTaskVersion(),
                    "RUNNING", retryCount(task), now));
        }
        if (!"RUNNING".equals(task.getStatus()) || task.getTaskVersion() != result.taskVersion() + 1) return;
        if (task.getProviderCallStartedAt() == null) {
            if (tasks.markProviderCallStarted(taskId, now) != 1) return;
            task.setProviderCallStartedAt(now);
        }
        if ("STARTED".equals(result.outcome())) return;
        if ("SUCCEEDED".equals(result.outcome())) {
            completeProvider(task, result, now);
        } else {
            completeProviderFailure(task, GenerationFailureCode.valueOf(result.failureCode()),
                    result.providerRequestId(), now);
        }
    }

    private void completeProvider(GenerationTask task, GenerationWorkerResultMessage result, Instant now) {
        if (!task.getWidth().equals(result.declaredWidth()) || !task.getHeight().equals(result.declaredHeight())
                || !task.getRequestedImageCount().equals(result.expectedImageCount())
                || result.providerResultSnapshot() == null || result.providerResultSnapshot().isBlank()) {
            throw new IllegalArgumentException("Provider result does not match the generation task");
        }
        int transferVersion = task.getTaskVersion() + 1;
        if (tasks.markReadyForTransfer(task.getId(), task.getTaskVersion(), result.providerRequestId(),
                result.providerResultSnapshot(), now) != 1) return;
        OutboxEvent command = command(OutboxEventType.GENERATION_IMAGE_TRANSFER, task.getId(), transferVersion, now);
        outbox.insertSelective(command);
        outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), transferVersion,
                "TRANSFERRING", retryCount(task), now));
    }

    private void completeProviderFailure(GenerationTask task, GenerationFailureCode failure,
            String providerRequestId, Instant now) {
        if (providerRequestId != null && !providerRequestId.isBlank()) {
            tasks.saveProviderRequestId(task.getId(), providerRequestId, now);
        }
        if (retryable(failure) && retryCount(task) < bailian.maxRetries()
                && tasks.requeueRunningForRetry(task.getId(), task.getTaskVersion(), now) == 1) {
            int nextVersion = task.getTaskVersion() + 1;
            OutboxEvent command = command(OutboxEventType.GENERATION_TASK_EXECUTE, task.getId(), nextVersion, now);
            command.setAvailableAt(now.plusSeconds(1L << retryCount(task))
                    .plusMillis(ThreadLocalRandom.current().nextLong(1001)));
            outbox.insertSelective(command);
            outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), nextVersion,
                    "QUEUED", retryCount(task) + 1, now));
            return;
        }
        boolean refund = refunds(failure);
        if (refund && task.getQuotaRefundedAt() == null
                && usage.refund(task.getUserId(), LocalDate.ofInstant(task.getCreatedAt(), QUOTA_ZONE),
                task.getRequestedImageCount(), now) != 1) {
            throw new IllegalStateException("Generation quota refund record is missing for task " + task.getId());
        }
        if (tasks.failRunning(task.getId(), failure.name(), refund ? now : null, now) != 1) return;
        outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), task.getTaskVersion() + 1,
                "FAILED", retryCount(task), now));
    }

    private void applyTransfer(long taskId, GenerationWorkerResultMessage result) {
        Instant now = clock.instant();
        GenerationTask task = tasks.selectByIdForUpdate(taskId);
        if (task == null || terminal(task.getStatus()) || !"TRANSFERRING".equals(task.getStatus())
                || task.getTaskVersion() != result.taskVersion()) return;
        if (task.getTransferStartedAt() == null) {
            if (tasks.markTransferStarted(taskId, result.taskVersion(), now) != 1) return;
            task.setTransferStartedAt(now);
        }
        if ("STARTED".equals(result.outcome())) return;
        if ("FAILED".equals(result.outcome())) {
            if (tasks.failTransferring(taskId, result.taskVersion(), result.failureCode(), now) == 1) {
                outbox.insertSelective(GenerationStatusOutboxEvent.create(taskId, result.taskVersion() + 1,
                        "FAILED", retryCount(task), now));
            }
            return;
        }
        persistImagesAndComplete(task, result, now);
    }

    private void persistImagesAndComplete(GenerationTask task, GenerationWorkerResultMessage result, Instant now) {
        List<GenerationWorkerResultMessage.TransferredImage> transferred = result.images();
        int expected = result.expectedImageCount();
        if (expected != task.getRequestedImageCount() || transferred.size() > expected
                || result.declaredWidth() != null && !result.declaredWidth().equals(task.getWidth())
                || result.declaredHeight() != null && !result.declaredHeight().equals(task.getHeight())) {
            throw new IllegalArgumentException("Transfer result does not match the generation task");
        }
        HashSet<Integer> indexes = new HashSet<>();
        for (var image : transferred) {
            long fileSize = Long.parseLong(image.fileSize());
            String expectedSuffix = "/" + task.getUserId() + "/tasks/" + task.getId()
                    + "/" + image.sourceIndex();
            if (!indexes.add(image.sourceIndex()) || image.sourceIndex() < 0 || image.sourceIndex() >= expected
                    || image.width() != task.getWidth() || image.height() != task.getHeight()
                    || image.objectKey() == null || !image.objectKey().endsWith(expectedSuffix)
                    || fileSize <= 0) {
                throw new IllegalArgumentException("Invalid transferred image result");
            }
            ImageAsset entity = new ImageAsset();
            entity.setUserId(task.getUserId());
            entity.setOrigin("GENERATED");
            entity.setLifecycle("PERSISTENT");
            entity.setOriginTaskId(task.getId());
            entity.setSourceIndex(image.sourceIndex());
            entity.setObjectKey(image.objectKey());
            entity.setOriginalObjectKey(GenerationImageObjectKeys.fromStoredValue(image.objectKey()).original());
            entity.setContentType("image/png");
            entity.setFileSize(fileSize);
            entity.setWidth(image.width());
            entity.setHeight(image.height());
            entity.setCreatedAt(now);
            images.insertSelective(entity);
        }
        String status = transferred.size() == expected ? GenerationTaskStatus.SUCCEEDED.name()
                : transferred.isEmpty() ? GenerationTaskStatus.FAILED.name()
                : GenerationTaskStatus.PARTIALLY_SUCCEEDED.name();
        String failure = "SUCCEEDED".equals(status) ? null : transferred.isEmpty()
                ? GenerationFailureCode.IMAGE_TRANSFER_FAILED.name()
                : GenerationFailureCode.IMAGE_TRANSFER_PARTIAL_FAILURE.name();
        if (tasks.completeTransferring(task.getId(), task.getTaskVersion(), status,
                transferred.size(), failure, now) != 1) {
            throw new IllegalStateException("Cannot complete generation transfer task " + task.getId());
        }
        outbox.insertSelective(GenerationStatusOutboxEvent.create(task.getId(), task.getTaskVersion() + 1,
                status, retryCount(task), now));
    }

    private static OutboxEvent command(OutboxEventType type, long taskId, int version, Instant now) {
        OutboxEvent event = new OutboxEvent();
        event.setEventType(type.name());
        event.setAggregateType("GENERATION_TASK");
        event.setAggregateId(taskId);
        event.setAggregateVersion((long) version);
        event.setStatus(OutboxStatus.PENDING.name());
        event.setRetryCount(0);
        event.setAvailableAt(now);
        event.setCreatedAt(now);
        event.setUpdatedAt(now);
        return event;
    }

    private static boolean retryable(GenerationFailureCode code) {
        return code == GenerationFailureCode.PROVIDER_CONNECTION_FAILED
                || code == GenerationFailureCode.PROVIDER_RATE_LIMITED
                || code == GenerationFailureCode.PROVIDER_SERVICE_UNAVAILABLE;
    }

    private static boolean refunds(GenerationFailureCode code) {
        return code == GenerationFailureCode.PROVIDER_CALL_OUTCOME_UNKNOWN || retryable(code);
    }

    private static boolean terminal(String status) {
        return "SUCCEEDED".equals(status) || "PARTIALLY_SUCCEEDED".equals(status) || "FAILED".equals(status);
    }

    private static int retryCount(GenerationTask task) {
        return task.getAttemptCount() == null ? 0 : task.getAttemptCount();
    }
}
