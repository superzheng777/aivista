package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.generation.config.GenerationTaskProperties;
import com.superz.aivista.generation.dto.CreateAgentGenerationTaskRequest;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AgentGenerationTaskCreationServiceTests {
    private static final Instant NOW = Instant.parse("2026-09-09T02:00:00Z");
    private static final String KEY = "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee";
    private final CreationTaskMapper creations = mock(CreationTaskMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final CreationTaskInputAssetMapper creationInputAssets = mock(CreationTaskInputAssetMapper.class);
    private final IdempotencyRecordMapper idempotency = mock(IdempotencyRecordMapper.class);
    private final GenerationTaskProvisioningService provisioning = mock(GenerationTaskProvisioningService.class);
    private AgentGenerationTaskCreationService service;

    @BeforeEach
    void setUp() {
        var properties = new GenerationTaskProperties(
                "bailian/qwen-image-2.0", 4, 12, 1000, 500, 1, 6, Map.of("3:4", "1536*2048"));
        service = new AgentGenerationTaskCreationService(creations, users, creationInputAssets, idempotency,
                new GenerationTaskSpecificationValidator(properties), provisioning,
                Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());
    }

    @Test
    void createsTaskUnderExistingAgentCreationThroughSharedProvisioning() {
        CreationTask creation = agentCreation();
        when(creations.selectSnapshotById(151L)).thenReturn(creation);
        when(users.selectIdForUpdate(7L)).thenReturn(7L);
        when(creations.selectByIdForUpdate(151L)).thenReturn(creation);
        when(creationInputAssets.selectAssetIdsByCreationTaskId(151L)).thenReturn(List.of(501L));
        GenerationTask task = new GenerationTask();
        task.setId(301L);
        task.setSessionId(101L);
        task.setStatus("QUEUED");
        task.setTaskVersion(0);
        task.setRequestedImageCount(1);
        task.setCreatedAt(NOW);
        when(provisioning.create(anyLong(), anyLong(), anyLong(), any(), any())).thenReturn(task);

        var response = service.create(151L, KEY, new CreateAgentGenerationTaskRequest(
                "IMAGE_TO_IMAGE", "改成蓝色海报", null, "3:4", true, 1, List.of("501")));

        assertThat(response.taskId()).isEqualTo("301");
        ArgumentCaptor<GenerationTaskSpecification> specification =
                ArgumentCaptor.forClass(GenerationTaskSpecification.class);
        verify(provisioning).create(org.mockito.Mockito.eq(7L), org.mockito.Mockito.eq(101L),
                org.mockito.Mockito.eq(151L), specification.capture(), org.mockito.Mockito.eq(NOW));
        assertThat(specification.getValue().inputAssetIds()).containsExactly(501L);
        verify(idempotency).insertSelective(any());
    }

    @Test
    void rejectsNormalCreationBeforeAnyBusinessWrite() {
        CreationTask creation = agentCreation();
        creation.setMode("NORMAL");
        when(creations.selectSnapshotById(151L)).thenReturn(creation);

        assertThatThrownBy(() -> service.create(151L, KEY, new CreateAgentGenerationTaskRequest(
                "TEXT_TO_IMAGE", "海报", null, "3:4", true, 1, List.of())))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo(ErrorCode.GENERATION_RESOURCE_NOT_FOUND));
        verify(users, never()).selectIdForUpdate(anyLong());
        verify(provisioning, never()).create(anyLong(), anyLong(), anyLong(), any(), any());
    }

    @Test
    void rejectsOperationThatConflictsWithInputAssets() {
        CreationTask creation = agentCreation();
        when(creations.selectSnapshotById(151L)).thenReturn(creation);
        when(users.selectIdForUpdate(7L)).thenReturn(7L);
        when(creations.selectByIdForUpdate(151L)).thenReturn(creation);
        when(creationInputAssets.selectAssetIdsByCreationTaskId(151L)).thenReturn(List.of(501L));

        assertThatThrownBy(() -> service.create(151L, KEY, new CreateAgentGenerationTaskRequest(
                "TEXT_TO_IMAGE", "修改图片", null, "3:4", true, 1, List.of("501"))))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_ERROR));
        verify(provisioning, never()).create(anyLong(), anyLong(), anyLong(), any(), any());
    }

    @Test
    void returnsPersistedResponseForAnIdenticalRetry() {
        CreationTask creation = agentCreation();
        when(creations.selectSnapshotById(151L)).thenReturn(creation);
        when(users.selectIdForUpdate(7L)).thenReturn(7L);
        when(creations.selectByIdForUpdate(151L)).thenReturn(creation);
        when(creationInputAssets.selectAssetIdsByCreationTaskId(151L)).thenReturn(List.of());
        IdempotencyRecord record = new IdempotencyRecord();
        record.setExpiresAt(NOW.plusSeconds(60));
        record.setRequestFingerprint(GenerationRequestFingerprint.sha256(
                7L, "151", "海报", null, "3:4", true, 1, List.of()));
        record.setResponseBody("{\"taskId\":\"301\",\"sessionId\":\"101\",\"status\":\"QUEUED\","+
                "\"taskVersion\":0,\"requestedImageCount\":1,\"createdAt\":\"2026-09-09T02:00:00Z\"}");
        when(idempotency.selectByOwnerScopeAndKeyForUpdate(
                7L, "AGENT_GENERATION_TASK_CREATE", KEY)).thenReturn(record);

        var response = service.create(151L, KEY, new CreateAgentGenerationTaskRequest(
                "TEXT_TO_IMAGE", "海报", null, "3:4", true, 1, List.of()));

        assertThat(response.taskId()).isEqualTo("301");
        verify(provisioning, never()).create(anyLong(), anyLong(), anyLong(), any(), any());
    }

    private static CreationTask agentCreation() {
        CreationTask creation = new CreationTask();
        creation.setId(151L);
        creation.setUserId(7L);
        creation.setSessionId(101L);
        creation.setMode("AGENT");
        return creation;
    }
}
