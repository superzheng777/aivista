package com.superz.aivista.generation.service;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.config.GenerationTaskProperties;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.GenerationTaskInputAsset;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.entity.UserGenerationDailyUsage;
import com.superz.aivista.generation.mapper.GenerationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.model.GenerationOperation;
import com.superz.aivista.generation.model.GenerationTaskStatus;
import com.superz.aivista.generation.model.OutboxEventType;
import com.superz.aivista.generation.model.OutboxStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Creates one queued generation task inside a transaction opened by its owning use case. */
@Service
public class GenerationTaskProvisioningService {
    private static final ZoneId QUOTA_ZONE = ZoneId.of("Asia/Shanghai");

    private final GenerationTaskMapper taskMapper;
    private final ImageAssetMapper imageAssetMapper;
    private final GenerationTaskInputAssetMapper taskInputAssetMapper;
    private final UserGenerationDailyUsageMapper dailyUsageMapper;
    private final OutboxEventMapper outboxEventMapper;
    private final GenerationTaskProperties properties;

    public GenerationTaskProvisioningService(GenerationTaskMapper taskMapper,
            ImageAssetMapper imageAssetMapper,
            GenerationTaskInputAssetMapper taskInputAssetMapper,
            UserGenerationDailyUsageMapper dailyUsageMapper,
            OutboxEventMapper outboxEventMapper,
            GenerationTaskProperties properties) {
        this.taskMapper = taskMapper;
        this.imageAssetMapper = imageAssetMapper;
        this.taskInputAssetMapper = taskInputAssetMapper;
        this.dailyUsageMapper = dailyUsageMapper;
        this.outboxEventMapper = outboxEventMapper;
        this.properties = properties;
    }

    public GenerationTask create(long userId, long sessionId, long creationTaskId,
            GenerationTaskSpecification specification, Instant now) {
        if (taskMapper.countActiveByUserId(userId) >= properties.maxActiveTasksPerUser()) {
            throw new BusinessException(ErrorCode.USER_GENERATION_CONCURRENCY_LIMIT);
        }
        reserveDailyQuota(userId, LocalDate.ofInstant(now, QUOTA_ZONE), specification.imageCount(), now);

        Dimension dimension = dimensionOf(specification.aspectRatio());
        GenerationTask task = new GenerationTask();
        task.setUserId(userId);
        task.setSessionId(sessionId);
        task.setCreationTaskId(creationTaskId);
        task.setOperation(specification.inputAssetIds().isEmpty()
                ? GenerationOperation.TEXT_TO_IMAGE.name() : GenerationOperation.IMAGE_TO_IMAGE.name());
        task.setModel(properties.model());
        task.setStatus(GenerationTaskStatus.QUEUED.name());
        task.setTaskVersion(0);
        task.setAttemptCount(0);
        task.setFinalPrompt(specification.prompt());
        task.setFinalNegativePrompt(specification.negativePrompt());
        task.setWidth(dimension.width());
        task.setHeight(dimension.height());
        task.setPromptExtend(specification.promptExtend());
        task.setRequestedImageCount(specification.imageCount());
        task.setCompletedImageCount(0);
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        taskMapper.insertSelective(task);
        persistInputAssets(task.getId(), specification.inputAssetIds(), userId, now);

        OutboxEvent execute = new OutboxEvent();
        execute.setEventType(OutboxEventType.GENERATION_TASK_EXECUTE.name());
        execute.setAggregateType("GENERATION_TASK");
        execute.setAggregateId(task.getId());
        execute.setAggregateVersion(task.getTaskVersion().longValue());
        execute.setStatus(OutboxStatus.PENDING.name());
        execute.setRetryCount(0);
        execute.setAvailableAt(now);
        execute.setCreatedAt(now);
        execute.setUpdatedAt(now);
        outboxEventMapper.insertSelective(execute);
        outboxEventMapper.insertSelective(GenerationStatusOutboxEvent.create(
                task.getId(), task.getTaskVersion(), task.getStatus(), task.getAttemptCount(), now));
        return task;
    }

    private void reserveDailyQuota(long userId, LocalDate usageDate, int imageCount, Instant now) {
        UserGenerationDailyUsage usage = dailyUsageMapper.selectByUserIdAndUsageDateForUpdate(userId, usageDate);
        if (usage == null) {
            if (imageCount > properties.dailyImageQuota()) {
                throw new BusinessException(ErrorCode.DAILY_GENERATION_QUOTA_EXCEEDED);
            }
            UserGenerationDailyUsage created = new UserGenerationDailyUsage();
            created.setUserId(userId);
            created.setUsageDate(usageDate);
            created.setRequestedImageCount(imageCount);
            created.setUpdatedAt(now);
            dailyUsageMapper.insertSelective(created);
            return;
        }
        if (dailyUsageMapper.incrementWithinQuota(userId, usageDate, imageCount,
                properties.dailyImageQuota(), now) != 1) {
            throw new BusinessException(ErrorCode.DAILY_GENERATION_QUOTA_EXCEEDED);
        }
    }

    private void persistInputAssets(long taskId, List<Long> assetIds, long userId, Instant now) {
        if (assetIds.isEmpty()) return;
        List<ImageAsset> assets = imageAssetMapper.selectUsableInputsForUpdate(userId, assetIds);
        if (assets.size() != assetIds.size()) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }
        Map<Long, ImageAsset> byId = assets.stream()
                .collect(java.util.stream.Collectors.toMap(ImageAsset::getId, asset -> asset));
        for (int index = 0; index < assetIds.size(); index++) {
            ImageAsset asset = byId.get(assetIds.get(index));
            if (asset == null) throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
            GenerationTaskInputAsset input = new GenerationTaskInputAsset();
            input.setTaskId(taskId);
            input.setAssetId(asset.getId());
            input.setSourceIndex(index);
            input.setCreatedAt(now);
            taskInputAssetMapper.insertSelective(input);
        }
    }

    private Dimension dimensionOf(String aspectRatio) {
        String size = properties.aspectRatios().get(aspectRatio);
        String[] parts = size.split("\\*", -1);
        if (parts.length != 2) throw new IllegalStateException("Invalid configured generation size: " + size);
        try {
            return new Dimension(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
        } catch (NumberFormatException exception) {
            throw new IllegalStateException("Invalid configured generation size: " + size, exception);
        }
    }

    private record Dimension(int width, int height) {
    }
}
