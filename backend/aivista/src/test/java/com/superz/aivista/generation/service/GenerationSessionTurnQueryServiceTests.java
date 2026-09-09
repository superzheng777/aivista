package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.dto.GenerationTaskSnapshotResponse;
import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.GenerationSession;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.CreationActivity;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.CreationActivityMapper;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class GenerationSessionTurnQueryServiceTests {
    @Test
    void returnsCreationTurnsInChronologicalOrderAndUsesTheOldestTaskAsCursor() {
        GenerationSessionMapper sessionMapper = mock(GenerationSessionMapper.class);
        ConversationMessageMapper messageMapper = mock(ConversationMessageMapper.class);
        CreationTaskMapper creationTaskMapper = mock(CreationTaskMapper.class);
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        ImageAssetMapper imageMapper = mock(ImageAssetMapper.class);
        GenerationTaskQueryService taskQueryService = mock(GenerationTaskQueryService.class);
        CreationActivityMapper activityMapper = mock(CreationActivityMapper.class);
        when(sessionMapper.selectOwnedById(201L, 7L)).thenReturn(new GenerationSession());
        when(creationTaskMapper.selectPageBySessionId(201L, null, 3))
                .thenReturn(List.of(agentCreationTask(23), creationTask(22), creationTask(21)));
        when(messageMapper.selectByCreationTaskIds(List.of(22L, 23L)))
                .thenReturn(List.of(userMessage(22, 3), assistantMessage(22, 4),
                        userMessage(23, 5)));
        GenerationTask task2 = task(302, 22);
        GenerationTask task3 = task(303, 23);
        GenerationTask task4 = task(304, 23);
        when(taskMapper.selectByCreationTaskIds(List.of(22L, 23L))).thenReturn(List.of(task2, task3, task4));
        CreationActivity activity = new CreationActivity();
        activity.setCreationTaskId(23L);
        activity.setActivityKey("tool:call-1");
        activity.setSequenceNo(1);
        activity.setActivityType("TOOL");
        activity.setState("COMPLETED");
        activity.setContent("文生图已完成。");
        when(activityMapper.selectByCreationTaskIds(List.of(22L, 23L))).thenReturn(List.of(activity));
        when(imageMapper.selectByOriginTaskIds(List.of(302L, 303L, 304L))).thenReturn(List.of());
        when(taskQueryService.snapshot(eq(task2), anyList())).thenReturn(snapshot("302"));
        when(taskQueryService.snapshot(eq(task3), anyList())).thenReturn(snapshot("303"));
        when(taskQueryService.snapshot(eq(task4), anyList())).thenReturn(snapshot("304"));

        var response = service(sessionMapper, messageMapper, creationTaskMapper, taskMapper, imageMapper,
                taskQueryService, activityMapper).list(7L, 201L, null, 2);

        assertThat(response.hasMore()).isTrue();
        assertThat(response.nextBefore()).isEqualTo("MjI");
        assertThat(response.items()).extracting(item -> item.userMessage().sequenceNo()).containsExactly(3, 5);
        assertThat(response.items().getFirst().assistantMessage().role()).isEqualTo("ASSISTANT");
        assertThat(response.items().getLast().assistantMessage()).isNull();
        assertThat(response.items().getLast().normalGenerationRequest()).isNull();
        assertThat(response.items()).extracting(item -> item.generations().getFirst().taskId())
                .containsExactly("302", "303");
        assertThat(response.items().getLast().generations()).extracting(GenerationTaskSnapshotResponse::taskId)
                .containsExactly("303", "304");
        assertThat(response.items().getLast().activities()).extracting(item -> item.activityKey())
                .containsExactly("tool:call-1");
        verify(taskMapper).selectByCreationTaskIds(List.of(22L, 23L));
        verify(imageMapper).selectByOriginTaskIds(List.of(302L, 303L, 304L));
    }

    @Test
    void rejectsForeignSessionAndInvalidCursor() {
        GenerationSessionMapper sessionMapper = mock(GenerationSessionMapper.class);
        GenerationSessionTurnQueryService service = service(sessionMapper,
                mock(ConversationMessageMapper.class), mock(CreationTaskMapper.class),
                mock(GenerationTaskMapper.class), mock(ImageAssetMapper.class),
                mock(GenerationTaskQueryService.class), mock(CreationActivityMapper.class));

        assertThatThrownBy(() -> service.list(7L, 201L, null, 20))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.GENERATION_RESOURCE_NOT_FOUND));

        when(sessionMapper.selectOwnedById(201L, 7L)).thenReturn(new GenerationSession());
        assertThatThrownBy(() -> service.list(7L, 201L, "bad-cursor", 5))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.INVALID_CURSOR));
    }

    private static GenerationSessionTurnQueryService service(GenerationSessionMapper sessionMapper,
            ConversationMessageMapper messageMapper, CreationTaskMapper creationTaskMapper,
            GenerationTaskMapper taskMapper, ImageAssetMapper imageMapper,
            GenerationTaskQueryService taskQueryService, CreationActivityMapper activityMapper) {
        return new GenerationSessionTurnQueryService(sessionMapper, messageMapper, creationTaskMapper,
                taskMapper, imageMapper, taskQueryService, activityMapper);
    }

    private static CreationTask creationTask(long id) {
        CreationTask task = new CreationTask();
        task.setId(id);
        task.setMode("NORMAL");
        task.setStatus("SUCCEEDED");
        task.setRevision(1L);
        return task;
    }

    private static CreationTask agentCreationTask(long id) {
        CreationTask task = creationTask(id);
        task.setMode("AGENT");
        task.setStatus("RUNNING");
        task.setRevision(0L);
        return task;
    }

    private static ConversationMessage userMessage(long creationTaskId, int sequenceNo) {
        ConversationMessage message = new ConversationMessage();
        message.setId(creationTaskId + 100);
        message.setCreationTaskId(creationTaskId);
        message.setSequenceNo(sequenceNo);
        message.setRole("USER");
        message.setContent("prompt " + sequenceNo);
        message.setCreatedAt(Instant.parse("2026-07-30T00:00:00Z"));
        return message;
    }

    private static ConversationMessage assistantMessage(long creationTaskId, int sequenceNo) {
        ConversationMessage message = new ConversationMessage();
        message.setId(creationTaskId + 200);
        message.setCreationTaskId(creationTaskId);
        message.setSequenceNo(sequenceNo);
        message.setRole("ASSISTANT");
        message.setCreatedAt(Instant.parse("2026-07-30T00:00:00Z"));
        return message;
    }

    private static GenerationTask task(long id, long creationTaskId) {
        GenerationTask task = new GenerationTask();
        task.setId(id);
        task.setCreationTaskId(creationTaskId);
        return task;
    }

    private static GenerationTaskSnapshotResponse snapshot(String taskId) {
        return new GenerationTaskSnapshotResponse(taskId, "201", "SUCCEEDED", 1, 0, 3, 1, 1,
                0, null, null, List.of(), Instant.parse("2026-07-30T00:00:00Z"), null);
    }
}
