package com.superz.aivista.generation.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.superz.aivista.generation.dto.CreateAgentCreationRequest;
import com.superz.aivista.generation.dto.CreateAgentCreationResponse;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.model.CreationMode;
import com.superz.aivista.generation.model.OutboxEventType;
import com.superz.aivista.generation.model.OutboxStatus;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 原子创建 Agent Creation、用户消息与可靠执行命令。 */
@Service
public class AgentCreationService {
    private static final String IDEMPOTENCY_SCOPE = "AGENT_CREATION_CREATE";
    private static final String NEW_SESSION_IDENTITY = "NEW";

    private final UserMapper users;
    private final ImageAssetMapper assets;
    private final IdempotencyRecordMapper idempotency;
    private final OutboxEventMapper outbox;
    private final CreationTaskStartService creationStart;
    private final GenerationTaskSpecificationValidator validator;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    public AgentCreationService(UserMapper users, ImageAssetMapper assets,
            IdempotencyRecordMapper idempotency, OutboxEventMapper outbox,
            CreationTaskStartService creationStart, GenerationTaskSpecificationValidator validator,
            Clock clock, ObjectMapper objectMapper) {
        this.users = users;
        this.assets = assets;
        this.idempotency = idempotency;
        this.outbox = outbox;
        this.creationStart = creationStart;
        this.validator = validator;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public CreateAgentCreationResponse create(long userId, String idempotencyKey,
            CreateAgentCreationRequest request) {
        Command command = normalize(userId, idempotencyKey, request);
        if (users.selectIdForUpdate(userId) == null) throw new BusinessException(ErrorCode.UNAUTHORIZED);
        Instant now = clock.instant();
        IdempotencyRecord existing = idempotency.selectByOwnerScopeAndKeyForUpdate(
                userId, IDEMPOTENCY_SCOPE, command.idempotencyKey());
        if (existing != null && existing.getExpiresAt().isAfter(now)) {
            return replay(existing, command.fingerprint());
        }
        if (existing != null) idempotency.deleteById(existing.getId());
        authorizeAssets(userId, command.inputAssetIds());

        var started = creationStart.start(userId, command.sessionId(), command.prompt(),
                CreationMode.AGENT.name(), command.inputAssetIds(), false, now);
        var creation = started.creation();
        OutboxEvent execute = new OutboxEvent();
        execute.setEventType(OutboxEventType.AGENT_EXECUTE.name());
        execute.setAggregateType("CREATION_TASK");
        execute.setAggregateId(creation.getId());
        execute.setAggregateVersion(creation.getRevision());
        execute.setStatus(OutboxStatus.PENDING.name());
        execute.setRetryCount(0);
        execute.setAvailableAt(now);
        execute.setCreatedAt(now);
        execute.setUpdatedAt(now);
        outbox.insertSelective(execute);

        CreateAgentCreationResponse response = new CreateAgentCreationResponse(
                creation.getId().toString(), started.session().getId().toString(),
                creation.getStatus(), creation.getRevision(), creation.getCreatedAt());
        saveIdempotency(userId, command, creation.getId(), response, now);
        return response;
    }

    private Command normalize(long userId, String idempotencyKey, CreateAgentCreationRequest request) {
        if (request == null || !isCanonicalUuid(idempotencyKey)) {
            throw invalid("Idempotency-Key：必须是 UUID v4 格式");
        }
        String prompt = validator.validateAgentPrompt(request.prompt());
        List<Long> inputAssetIds = GenerationTaskSpecificationValidator.normalizeInputAssetIds(
                request.inputAssetIds());
        Long sessionId = CreationTaskStartService.parseSessionId(request.sessionId());
        String identity = sessionId == null ? NEW_SESSION_IDENTITY : sessionId.toString();
        return new Command(sessionId, prompt, inputAssetIds, idempotencyKey,
                GenerationRequestFingerprint.sha256Agent(userId, identity, prompt, inputAssetIds));
    }

    private void authorizeAssets(long userId, List<Long> inputAssetIds) {
        if (inputAssetIds.isEmpty()) return;
        List<ImageAsset> usable = assets.selectUsableInputsForUpdate(userId, inputAssetIds);
        if (usable.size() != inputAssetIds.size()) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }
    }

    private CreateAgentCreationResponse replay(IdempotencyRecord record, String fingerprint) {
        if (!fingerprint.equals(record.getRequestFingerprint())) {
            throw new BusinessException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
        try {
            var body = objectMapper.readTree(record.getResponseBody());
            return new CreateAgentCreationResponse(body.required("creationTaskId").asText(),
                    body.required("sessionId").asText(), body.required("status").asText(),
                    body.required("revision").asLong(), Instant.parse(body.required("createdAt").asText()));
        } catch (RuntimeException | JsonProcessingException exception) {
            throw new IllegalStateException("Invalid persisted Agent creation response", exception);
        }
    }

    private void saveIdempotency(long userId, Command command, long creationTaskId,
            CreateAgentCreationResponse response, Instant now) {
        try {
            IdempotencyRecord record = new IdempotencyRecord();
            record.setOwnerId(userId);
            record.setScope(IDEMPOTENCY_SCOPE);
            record.setIdempotencyKey(command.idempotencyKey());
            record.setRequestFingerprint(command.fingerprint());
            record.setResourceType("CREATION_TASK");
            record.setResourceId(creationTaskId);
            record.setResponseStatus(202);
            record.setResponseBody(objectMapper.writeValueAsString(Map.of(
                    "creationTaskId", response.creationTaskId(), "sessionId", response.sessionId(),
                    "status", response.status(), "revision", response.revision(),
                    "createdAt", response.createdAt().toString())));
            record.setCreatedAt(now);
            record.setExpiresAt(now.plus(Duration.ofMinutes(30)));
            idempotency.insertSelective(record);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot persist Agent creation idempotency response", exception);
        }
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

    private record Command(Long sessionId, String prompt, List<Long> inputAssetIds,
            String idempotencyKey, String fingerprint) {
    }
}
