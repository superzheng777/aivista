package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.generation.config.GenerationTaskProperties;
import com.superz.aivista.generation.dto.CreateGenerationTaskRequest;
import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.CreationTaskInputAsset;
import com.superz.aivista.generation.entity.GenerationSession;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.GenerationTaskInputAsset;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.entity.UserGenerationDailyUsage;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GenerationTaskCreationServiceTests {
    private static final long USER_ID = 7L;
    private static final Instant NOW = Instant.parse("2026-07-28T01:02:03Z");
    private static final String IDEMPOTENCY_KEY = "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee";

    private final UserMapper userMapper = mock(UserMapper.class);
    private final GenerationSessionMapper sessionMapper = mock(GenerationSessionMapper.class);
    private final ConversationMessageMapper messageMapper = mock(ConversationMessageMapper.class);
    private final CreationTaskMapper creationTaskMapper = mock(CreationTaskMapper.class);
    private final CreationTaskInputAssetMapper creationTaskInputAssetMapper = mock(CreationTaskInputAssetMapper.class);
    private final GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
    private final ImageAssetMapper imageAssetMapper = mock(ImageAssetMapper.class);
    private final GenerationTaskInputAssetMapper taskInputAssetMapper = mock(GenerationTaskInputAssetMapper.class);
    private final UserGenerationDailyUsageMapper dailyUsageMapper = mock(UserGenerationDailyUsageMapper.class);
    private final OutboxEventMapper outboxEventMapper = mock(OutboxEventMapper.class);
    private final IdempotencyRecordMapper idempotencyRecordMapper = mock(IdempotencyRecordMapper.class);
    private GenerationTaskCreationService service;

    @BeforeEach
    void setUp() {
        GenerationTaskProperties properties = new GenerationTaskProperties(
                "bailian/qwen-image-2.0", 4, 12, 1000, 500, 1, 6,
                Map.of("1:1", "2048*2048"));
        var provisioning = new GenerationTaskProvisioningService(taskMapper, imageAssetMapper,
                taskInputAssetMapper, dailyUsageMapper, outboxEventMapper, properties);
        var specificationValidator = new GenerationTaskSpecificationValidator(properties);
        var creationStart = new CreationTaskStartService(sessionMapper, messageMapper,
                creationTaskMapper, creationTaskInputAssetMapper);
        service = new GenerationTaskCreationService(userMapper, creationStart, provisioning, idempotencyRecordMapper,
                specificationValidator,
                Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());
        when(userMapper.selectIdForUpdate(USER_ID)).thenReturn(USER_ID);
        when(taskMapper.countActiveByUserId(USER_ID)).thenReturn(0);
        when(dailyUsageMapper.selectByUserIdAndUsageDateForUpdate(anyLong(), any())).thenReturn(null);
        when(sessionMapper.insertSelective(any())).thenAnswer(invocation -> {
            ((GenerationSession) invocation.getArgument(0)).setId(101L);
            return 1;
        });
        when(creationTaskMapper.insertSelective(any())).thenAnswer(invocation -> {
            ((CreationTask) invocation.getArgument(0)).setId(151L);
            return 1;
        });
        java.util.concurrent.atomic.AtomicLong messageId = new java.util.concurrent.atomic.AtomicLong(200L);
        when(messageMapper.insertSelective(any())).thenAnswer(invocation -> {
            ((ConversationMessage) invocation.getArgument(0)).setId(messageId.incrementAndGet());
            return 1;
        });
        when(taskMapper.insertSelective(any())).thenAnswer(invocation -> {
            ((GenerationTask) invocation.getArgument(0)).setId(301L);
            return 1;
        });
    }

    @Test
    void createsNewSessionTaskUsageAndOutboxInOneCommand() {
        var response = service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest(null, "future city", " ", "1:1", null, 2));

        assertThat(response.taskId()).isEqualTo("301");
        assertThat(response.sessionId()).isEqualTo("101");
        assertThat(response.status()).isEqualTo("QUEUED");
        assertThat(response.requestedImageCount()).isEqualTo(2);

        ArgumentCaptor<UserGenerationDailyUsage> usage = ArgumentCaptor.forClass(UserGenerationDailyUsage.class);
        ArgumentCaptor<GenerationTask> task = ArgumentCaptor.forClass(GenerationTask.class);
        ArgumentCaptor<OutboxEvent> event = ArgumentCaptor.forClass(OutboxEvent.class);
        ArgumentCaptor<IdempotencyRecord> idempotencyRecord = ArgumentCaptor.forClass(IdempotencyRecord.class);
        verify(dailyUsageMapper).insertSelective(usage.capture());
        verify(taskMapper).insertSelective(task.capture());
        verify(outboxEventMapper, org.mockito.Mockito.times(2)).insertSelective(event.capture());
        verify(idempotencyRecordMapper).insertSelective(idempotencyRecord.capture());
        assertThat(usage.getValue().getRequestedImageCount()).isEqualTo(2);
        assertThat(task.getValue().getFinalPrompt()).isEqualTo("future city");
        assertThat(task.getValue().getCreationTaskId()).isEqualTo(151L);
        assertThat(task.getValue().getFinalNegativePrompt()).isNull();
        assertThat(task.getValue().getWidth()).isEqualTo(2048);
        assertThat(task.getValue().getPromptExtend()).isTrue();
        assertThat(event.getAllValues()).extracting(OutboxEvent::getAggregateId).containsOnly(301L);
        assertThat(event.getAllValues()).extracting(OutboxEvent::getEventType)
                .containsExactly("GENERATION_TASK_EXECUTE", "GENERATION_TASK_STATUS_CHANGED");
        assertThat(event.getAllValues().get(1).getPayloadJson())
                .isEqualTo("{\"status\":\"QUEUED\",\"modelRetryCount\":0}");
        assertThat(idempotencyRecord.getValue().getResponseBody())
                .contains("\"createdAt\":\"2026-07-28T01:02:03Z\"");
    }

    @Test
    void createsExistingSessionTaskWithOnlyCurrentPromptWhileHoldingLastMessageLock() {
        GenerationSession existingSession = new GenerationSession();
        existingSession.setId(101L);
        when(sessionMapper.selectOwnedByIdForUpdate(101L, USER_ID)).thenReturn(existingSession);
        when(messageMapper.selectLastSequenceNoForUpdate(101L)).thenReturn(2);

        service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest("101", "future city", "no blur", "1:1", true, 1));

        ArgumentCaptor<ConversationMessage> message = ArgumentCaptor.forClass(ConversationMessage.class);
        ArgumentCaptor<GenerationTask> task = ArgumentCaptor.forClass(GenerationTask.class);
        verify(messageMapper, org.mockito.Mockito.times(2)).insertSelective(message.capture());
        verify(taskMapper).insertSelective(task.capture());
        verify(taskMapper, never()).countActiveBySessionId(101L);
        verify(messageMapper).selectLastSequenceNoForUpdate(101L);
        assertThat(message.getAllValues()).extracting(ConversationMessage::getSequenceNo).containsExactly(3, 4);
        assertThat(message.getAllValues()).extracting(ConversationMessage::getRole).containsExactly("USER", "ASSISTANT");
        assertThat(task.getValue().getFinalPrompt()).isEqualTo("future city");
        assertThat(task.getValue().getFinalNegativePrompt()).isEqualTo("no blur");
    }

    @Test
    void preservesUserImagesAtBothCreationAndGenerationLevels() {
        ImageAsset first = new ImageAsset();
        first.setId(501L);
        ImageAsset second = new ImageAsset();
        second.setId(502L);
        when(imageAssetMapper.selectUsableInputsForUpdate(USER_ID, List.of(501L, 502L)))
                .thenReturn(List.of(first, second));

        service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest(null, "make a poster", List.of("501", "502"),
                        null, "1:1", true, 1));

        ArgumentCaptor<CreationTaskInputAsset> creationInputs =
                ArgumentCaptor.forClass(CreationTaskInputAsset.class);
        ArgumentCaptor<GenerationTaskInputAsset> generationInputs =
                ArgumentCaptor.forClass(GenerationTaskInputAsset.class);
        verify(creationTaskInputAssetMapper, org.mockito.Mockito.times(2))
                .insertSelective(creationInputs.capture());
        verify(taskInputAssetMapper, org.mockito.Mockito.times(2))
                .insertSelective(generationInputs.capture());
        assertThat(creationInputs.getAllValues()).extracting(CreationTaskInputAsset::getImageAssetId)
                .containsExactly(501L, 502L);
        assertThat(generationInputs.getAllValues()).extracting(GenerationTaskInputAsset::getAssetId)
                .containsExactly(501L, 502L);
    }

    @Test
    void returnsExistingTaskForSameIdempotencyKeyWithoutAdditionalWrites() {
        IdempotencyRecord existing = idempotencyRecord(GenerationRequestFingerprint.sha256(
                USER_ID, "NEW", "future city", null, "1:1", true, 2));
        when(idempotencyRecordMapper.selectByOwnerScopeAndKeyForUpdate(USER_ID, "GENERATION_TASK_CREATE", IDEMPOTENCY_KEY))
                .thenReturn(existing);

        var response = service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest(null, "future city", null, "1:1", null, 2));

        assertThat(response.taskId()).isEqualTo("301");
        verify(sessionMapper, never()).insertSelective(any());
        verify(taskMapper, never()).insertSelective(any());
        verify(outboxEventMapper, never()).insertSelective(any());
    }

    @Test
    void rejectsSameIdempotencyKeyWhenFingerprintDiffers() {
        when(idempotencyRecordMapper.selectByOwnerScopeAndKeyForUpdate(USER_ID, "GENERATION_TASK_CREATE", IDEMPOTENCY_KEY))
                .thenReturn(idempotencyRecord("different"));

        assertThatThrownBy(() -> service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest(null, "future city", null, "1:1", null, 2)))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo(ErrorCode.IDEMPOTENCY_KEY_CONFLICT));
    }

    @Test
    void replacesAnExpiredIdempotencyRecordBeforeCreatingANewTask() {
        IdempotencyRecord expired = idempotencyRecord("different");
        expired.setId(401L);
        expired.setExpiresAt(NOW.minusSeconds(1));
        when(idempotencyRecordMapper.selectByOwnerScopeAndKeyForUpdate(USER_ID, "GENERATION_TASK_CREATE", IDEMPOTENCY_KEY))
                .thenReturn(expired);

        service.create(USER_ID, IDEMPOTENCY_KEY,
                new CreateGenerationTaskRequest(null, "future city", null, "1:1", null, 2));

        verify(idempotencyRecordMapper).deleteById(401L);
        verify(taskMapper).insertSelective(any());
    }

    private static IdempotencyRecord idempotencyRecord(String fingerprint) {
        IdempotencyRecord record = new IdempotencyRecord();
        record.setRequestFingerprint(fingerprint);
        record.setExpiresAt(NOW.plusSeconds(1));
        record.setResponseBody("{\"taskId\":\"301\",\"sessionId\":\"101\",\"status\":\"QUEUED\",\"taskVersion\":0,\"requestedImageCount\":2,\"createdAt\":\"2026-07-28T01:02:03Z\"}");
        return record;
    }

}
