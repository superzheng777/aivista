package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.idempotency.IdempotencyRecord;
import com.superz.aivista.common.idempotency.IdempotencyRecordMapper;
import com.superz.aivista.generation.config.GenerationTaskProperties;
import com.superz.aivista.generation.dto.CreateAgentCreationRequest;
import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.GenerationSession;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.user.mapper.UserMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AgentCreationServiceTests {
    private static final long USER_ID = 7L;
    private static final Instant NOW = Instant.parse("2026-09-09T01:02:03Z");
    private static final String KEY = "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee";

    private final UserMapper users = mock(UserMapper.class);
    private final ImageAssetMapper assets = mock(ImageAssetMapper.class);
    private final IdempotencyRecordMapper idempotency = mock(IdempotencyRecordMapper.class);
    private final OutboxEventMapper outbox = mock(OutboxEventMapper.class);
    private final GenerationSessionMapper sessions = mock(GenerationSessionMapper.class);
    private final ConversationMessageMapper messages = mock(ConversationMessageMapper.class);
    private final CreationTaskMapper creations = mock(CreationTaskMapper.class);
    private final CreationTaskInputAssetMapper creationInputs = mock(CreationTaskInputAssetMapper.class);
    private AgentCreationService service;

    @BeforeEach
    void setUp() {
        var properties = new GenerationTaskProperties("bailian/qwen-image-2.0", 4, 12,
                1000, 500, 1, 6, Map.of("1:1", "2048*2048"));
        var start = new CreationTaskStartService(sessions, messages, creations, creationInputs);
        service = new AgentCreationService(users, assets, idempotency, outbox, start,
                new GenerationTaskSpecificationValidator(properties), Clock.fixed(NOW, ZoneOffset.UTC),
                new ObjectMapper());
        when(users.selectIdForUpdate(USER_ID)).thenReturn(USER_ID);
        when(sessions.insertSelective(any())).thenAnswer(call -> {
            ((GenerationSession) call.getArgument(0)).setId(101L);
            return 1;
        });
        when(creations.insertSelective(any())).thenAnswer(call -> {
            ((CreationTask) call.getArgument(0)).setId(151L);
            return 1;
        });
        when(messages.insertSelective(any())).thenAnswer(call -> {
            ((ConversationMessage) call.getArgument(0)).setId(201L);
            return 1;
        });
    }

    @Test
    void createsAgentCreationWithOnlyUserMessageAndExecuteOutbox() {
        ImageAsset image = new ImageAsset();
        image.setId(501L);
        when(assets.selectUsableInputsForUpdate(USER_ID, List.of(501L))).thenReturn(List.of(image));

        var response = service.create(USER_ID, KEY,
                new CreateAgentCreationRequest(null, "设计一张海报", List.of("501")));

        assertThat(response.creationTaskId()).isEqualTo("151");
        assertThat(response.status()).isEqualTo("RUNNING");
        ArgumentCaptor<CreationTask> creation = ArgumentCaptor.forClass(CreationTask.class);
        ArgumentCaptor<ConversationMessage> message = ArgumentCaptor.forClass(ConversationMessage.class);
        ArgumentCaptor<OutboxEvent> event = ArgumentCaptor.forClass(OutboxEvent.class);
        verify(creations).insertSelective(creation.capture());
        verify(messages).insertSelective(message.capture());
        verify(outbox).insertSelective(event.capture());
        assertThat(creation.getValue().getMode()).isEqualTo("AGENT");
        assertThat(creation.getValue().getRevision()).isZero();
        assertThat(message.getValue().getRole()).isEqualTo("USER");
        assertThat(event.getValue().getEventType()).isEqualTo("AGENT_EXECUTE");
        assertThat(event.getValue().getAggregateType()).isEqualTo("CREATION_TASK");
        assertThat(event.getValue().getAggregateId()).isEqualTo(151L);
        verify(idempotency).insertSelective(any(IdempotencyRecord.class));
    }

    @Test
    void rejectsAnInputAssetThatIsNotUsableByTheCurrentUser() {
        when(assets.selectUsableInputsForUpdate(USER_ID, List.of(501L))).thenReturn(List.of());

        assertThatThrownBy(() -> service.create(USER_ID, KEY,
                new CreateAgentCreationRequest(null, "设计一张海报", List.of("501"))))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getErrorCode()).isEqualTo(ErrorCode.GENERATION_RESOURCE_NOT_FOUND));
        verify(creations, never()).insertSelective(any());
        verify(outbox, never()).insertSelective(any());
    }
}
