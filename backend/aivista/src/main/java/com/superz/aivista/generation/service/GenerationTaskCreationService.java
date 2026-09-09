package com.superz.aivista.generation.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.dto.CreateGenerationTaskRequest;
import com.superz.aivista.generation.dto.CreateGenerationTaskResponse;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.model.CreationMode;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 原子创建普通文生图会话、消息、任务、额度记录与执行 Outbox 事件。 */
@Service
public class GenerationTaskCreationService {
    private static final String NEW_SESSION_IDENTITY = "NEW";
    private static final String IDEMPOTENCY_SCOPE = "GENERATION_TASK_CREATE";

    private final UserMapper userMapper;
    private final CreationTaskStartService creationStartService;
    private final GenerationTaskProvisioningService provisioningService;
    private final IdempotencyRecordMapper idempotencyRecordMapper;
    private final GenerationTaskSpecificationValidator specificationValidator;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    public GenerationTaskCreationService(
            UserMapper userMapper,
            CreationTaskStartService creationStartService,
            GenerationTaskProvisioningService provisioningService,
            IdempotencyRecordMapper idempotencyRecordMapper,
            GenerationTaskSpecificationValidator specificationValidator,
            Clock clock, ObjectMapper objectMapper) {
        this.userMapper = userMapper;
        this.creationStartService = creationStartService;
        this.provisioningService = provisioningService;
        this.idempotencyRecordMapper = idempotencyRecordMapper;
        this.specificationValidator = specificationValidator;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public CreateGenerationTaskResponse create(long userId, String idempotencyKey,
            CreateGenerationTaskRequest request) {
        CreationCommand command = validateAndNormalize(userId, idempotencyKey, request);
        // 所有创建请求先锁用户行：串行化跨会话的并发数与每日额度判断。
        if (userMapper.selectIdForUpdate(userId) == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }

        Instant now = clock.instant();
        IdempotencyRecord existing = idempotencyRecordMapper.selectByOwnerScopeAndKeyForUpdate(
                userId, IDEMPOTENCY_SCOPE, command.idempotencyKey());
        if (existing != null && existing.getExpiresAt().isAfter(now)) {
            return idempotentResponse(existing, command.requestFingerprint());
        }
        if (existing != null) {
            idempotencyRecordMapper.deleteById(existing.getId());
        }

        // 已有会话会在 loadOrCreateSession 中继续加锁，锁顺序始终是“用户 → 会话”。
        var started = creationStartService.start(userId, command.sessionId(), command.prompt(),
                CreationMode.NORMAL.name(), command.inputAssetIds(), true, now);
        GenerationTask task = provisioningService.create(userId, started.session().getId(), started.creation().getId(),
                new GenerationTaskSpecification(command.prompt(), command.negativePrompt(), command.aspectRatio(),
                        command.promptExtend(), command.imageCount(), command.inputAssetIds()), now);

        CreateGenerationTaskResponse response = responseOf(task);
        saveIdempotencyRecord(userId, command, task.getId(), response, now);
        return response;
    }

    private CreationCommand validateAndNormalize(long userId, String idempotencyKey,
            CreateGenerationTaskRequest request) {
        if (request == null || !isCanonicalUuid(idempotencyKey)) {
            throw invalid("Idempotency-Key：必须是 UUID v4 格式");
        }
        GenerationTaskSpecification specification = specificationValidator.validate(
                request.prompt(), request.negativePrompt(), request.aspectRatio(), request.promptExtend(),
                request.imageCount(), request.inputAssetIds());

        Long sessionId = CreationTaskStartService.parseSessionId(request.sessionId());
        // 新会话没有数据库 ID，使用稳定标识参与指纹，避免与已有会话请求混淆。
        String sessionIdentity = sessionId == null ? NEW_SESSION_IDENTITY : Long.toString(sessionId);
        List<Long> inputAssetIds = specification.inputAssetIds();
        String fingerprint = GenerationRequestFingerprint.sha256(
                userId, sessionIdentity, specification.prompt(), specification.negativePrompt(),
                specification.aspectRatio(), specification.promptExtend(), specification.imageCount(), inputAssetIds);
        return new CreationCommand(sessionId, specification.prompt(), specification.negativePrompt(),
                specification.aspectRatio(), specification.promptExtend(), specification.imageCount(),
                inputAssetIds, idempotencyKey, fingerprint);
    }

    // 幂等响应
    private CreateGenerationTaskResponse idempotentResponse(IdempotencyRecord record, String fingerprint) {
        if (!fingerprint.equals(record.getRequestFingerprint())) {
            throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
        try {
            var response = objectMapper.readTree(record.getResponseBody());
            return new CreateGenerationTaskResponse(
                    response.required("taskId").asText(),
                    response.required("sessionId").asText(),
                    response.required("status").asText(),
                    response.required("taskVersion").asInt(),
                    response.required("requestedImageCount").asInt(),
                    Instant.parse(response.required("createdAt").asText()));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Invalid persisted idempotency response", exception);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("Invalid persisted idempotency response", exception);
        }
    }

    private void saveIdempotencyRecord(long userId, CreationCommand command, long taskId,
            CreateGenerationTaskResponse response, Instant now) {
        try {
            IdempotencyRecord record = new IdempotencyRecord();
            record.setOwnerId(userId);
            record.setScope(IDEMPOTENCY_SCOPE);
            record.setIdempotencyKey(command.idempotencyKey());
            record.setRequestFingerprint(command.requestFingerprint());
            record.setResourceType("GENERATION_TASK");
            record.setResourceId(taskId);
            record.setResponseStatus(202);
            record.setResponseBody(objectMapper.writeValueAsString(Map.of(
                    "taskId", response.taskId(),
                    "sessionId", response.sessionId(),
                    "status", response.status(),
                    "taskVersion", response.taskVersion(),
                    "requestedImageCount", response.requestedImageCount(),
                    "createdAt", response.createdAt().toString())));
            record.setCreatedAt(now);
            record.setExpiresAt(now.plus(Duration.ofMinutes(30)));
            idempotencyRecordMapper.insertSelective(record);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot persist idempotency response", exception);
        }
    }

    private CreateGenerationTaskResponse responseOf(GenerationTask task) {
        return new CreateGenerationTaskResponse(
                Long.toString(task.getId()),
                Long.toString(task.getSessionId()),
                task.getStatus(),
                task.getTaskVersion(),
                task.getRequestedImageCount(),
                task.getCreatedAt());
    }

    private static boolean isCanonicalUuid(String value) {
        if (value == null) {
            return false;
        }
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

    private record CreationCommand(
            Long sessionId,
            String prompt,
            String negativePrompt,
            String aspectRatio,
            boolean promptExtend,
            int imageCount,
            List<Long> inputAssetIds,
            String idempotencyKey,
            String requestFingerprint) {
    }

}
