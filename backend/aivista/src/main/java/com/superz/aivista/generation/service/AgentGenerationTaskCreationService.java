package com.superz.aivista.generation.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.superz.aivista.generation.dto.CreateAgentGenerationTaskRequest;
import com.superz.aivista.generation.dto.CreateGenerationTaskResponse;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.model.CreationMode;
import com.superz.aivista.generation.model.GenerationOperation;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Idempotently creates a generation task under an existing Agent Creation. */
@Service
public class AgentGenerationTaskCreationService {
    private static final String IDEMPOTENCY_SCOPE = "AGENT_GENERATION_TASK_CREATE";

    private final CreationTaskMapper creationTaskMapper;
    private final UserMapper userMapper;
    private final CreationTaskInputAssetMapper creationInputAssets;
    private final IdempotencyRecordMapper idempotencyRecordMapper;
    private final GenerationTaskSpecificationValidator specificationValidator;
    private final GenerationTaskProvisioningService provisioningService;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    public AgentGenerationTaskCreationService(CreationTaskMapper creationTaskMapper, UserMapper userMapper,
            CreationTaskInputAssetMapper creationInputAssets,
            IdempotencyRecordMapper idempotencyRecordMapper,
            GenerationTaskSpecificationValidator specificationValidator,
            GenerationTaskProvisioningService provisioningService, Clock clock, ObjectMapper objectMapper) {
        this.creationTaskMapper = creationTaskMapper;
        this.userMapper = userMapper;
        this.creationInputAssets = creationInputAssets;
        this.idempotencyRecordMapper = idempotencyRecordMapper;
        this.specificationValidator = specificationValidator;
        this.provisioningService = provisioningService;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public CreateGenerationTaskResponse create(long creationTaskId, String idempotencyKey,
            CreateAgentGenerationTaskRequest request) {
        if (request == null || !isCanonicalUuid(idempotencyKey)) {
            throw invalid("Idempotency-Key：必须是 UUID v4 格式");
        }
        CreationTask snapshot = creationTaskMapper.selectSnapshotById(creationTaskId);
        if (snapshot == null || !CreationMode.AGENT.name().equals(snapshot.getMode())) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }
        long userId = snapshot.getUserId();
        if (userMapper.selectIdForUpdate(userId) == null) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }
        CreationTask creation = creationTaskMapper.selectByIdForUpdate(creationTaskId);
        if (creation == null || creation.getUserId() != userId
                || !CreationMode.AGENT.name().equals(creation.getMode())) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }

        GenerationTaskSpecification specification = specificationValidator.validate(
                request.prompt(), request.negativePrompt(), request.aspectRatio(), request.promptExtend(),
                request.imageCount(), request.inputAssetIds());
        String expectedOperation = specification.inputAssetIds().isEmpty()
                ? GenerationOperation.TEXT_TO_IMAGE.name() : GenerationOperation.IMAGE_TO_IMAGE.name();
        if (!expectedOperation.equals(request.operation())) {
            throw invalid("operation：必须与输入图片数量一致");
        }
        if (!creationInputAssets.selectAssetIdsByCreationTaskId(creationTaskId)
                .containsAll(specification.inputAssetIds())) {
            throw new BusinessException(ErrorCode.MEDIA_FORBIDDEN);
        }
        String fingerprint = GenerationRequestFingerprint.sha256(userId, Long.toString(creationTaskId),
                specification.prompt(), specification.negativePrompt(), specification.aspectRatio(),
                specification.promptExtend(), specification.imageCount(), specification.inputAssetIds());
        Instant now = clock.instant();
        IdempotencyRecord existing = idempotencyRecordMapper.selectByOwnerScopeAndKeyForUpdate(
                userId, IDEMPOTENCY_SCOPE, idempotencyKey);
        if (existing != null && existing.getExpiresAt().isAfter(now)) {
            return idempotentResponse(existing, fingerprint);
        }
        if (existing != null) idempotencyRecordMapper.deleteById(existing.getId());

        GenerationTask task = provisioningService.create(userId, creation.getSessionId(), creationTaskId,
                specification, now);
        CreateGenerationTaskResponse response = responseOf(task);
        saveIdempotencyRecord(userId, idempotencyKey, fingerprint, task.getId(), response, now);
        return response;
    }

    private CreateGenerationTaskResponse idempotentResponse(IdempotencyRecord record, String fingerprint) {
        if (!fingerprint.equals(record.getRequestFingerprint())) {
            throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
        try {
            var response = objectMapper.readTree(record.getResponseBody());
            return new CreateGenerationTaskResponse(response.required("taskId").asText(),
                    response.required("sessionId").asText(), response.required("status").asText(),
                    response.required("taskVersion").asInt(), response.required("requestedImageCount").asInt(),
                    Instant.parse(response.required("createdAt").asText()));
        } catch (JsonProcessingException | RuntimeException exception) {
            throw new IllegalStateException("Invalid persisted idempotency response", exception);
        }
    }

    private void saveIdempotencyRecord(long userId, String key, String fingerprint, long taskId,
            CreateGenerationTaskResponse response, Instant now) {
        try {
            IdempotencyRecord record = new IdempotencyRecord();
            record.setOwnerId(userId);
            record.setScope(IDEMPOTENCY_SCOPE);
            record.setIdempotencyKey(key);
            record.setRequestFingerprint(fingerprint);
            record.setResourceType("GENERATION_TASK");
            record.setResourceId(taskId);
            record.setResponseStatus(202);
            record.setResponseBody(objectMapper.writeValueAsString(Map.of(
                    "taskId", response.taskId(), "sessionId", response.sessionId(), "status", response.status(),
                    "taskVersion", response.taskVersion(), "requestedImageCount", response.requestedImageCount(),
                    "createdAt", response.createdAt().toString())));
            record.setCreatedAt(now);
            record.setExpiresAt(now.plus(Duration.ofMinutes(30)));
            idempotencyRecordMapper.insertSelective(record);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot persist idempotency response", exception);
        }
    }

    private static CreateGenerationTaskResponse responseOf(GenerationTask task) {
        return new CreateGenerationTaskResponse(Long.toString(task.getId()), Long.toString(task.getSessionId()),
                task.getStatus(), task.getTaskVersion(), task.getRequestedImageCount(), task.getCreatedAt());
    }

    private static boolean isCanonicalUuid(String value) {
        if (value == null) return false;
        try {
            UUID uuid = UUID.fromString(value);
            return uuid.version() == 4 && uuid.toString().equals(value);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.VALIDATION_ERROR, message);
    }
}
