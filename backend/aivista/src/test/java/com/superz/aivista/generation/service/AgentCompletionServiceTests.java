package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.message.AgentCompletionCommand;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AgentCompletionServiceTests {
    private static final Instant NOW = Instant.parse("2026-09-09T03:00:00Z");
    private final CreationTaskMapper creations = mock(CreationTaskMapper.class);
    private final ConversationMessageMapper messages = mock(ConversationMessageMapper.class);
    private final GenerationSessionMapper sessions = mock(GenerationSessionMapper.class);
    private final AgentActivityService activities = mock(AgentActivityService.class);
    private final AgentCompletionService service = new AgentCompletionService(creations, messages, sessions,
            Clock.fixed(NOW, ZoneOffset.UTC), activities);

    @Test
    void atomicallyWritesTheFinalAssistantMessageAndCreationOutcome() {
        when(creations.selectByIdForUpdate(151L)).thenReturn(running());
        when(messages.selectLastSequenceNoForUpdate(101L)).thenReturn(3);
        when(creations.completeRunning(151L, 0L, "SUCCEEDED", null, NOW)).thenReturn(1);

        var response = service.complete(command("SUCCEEDED", null, "  海报已生成。  "));

        assertThat(response.status()).isEqualTo("SUCCEEDED");
        assertThat(response.revision()).isEqualTo(1);
        ArgumentCaptor<ConversationMessage> message = ArgumentCaptor.forClass(ConversationMessage.class);
        verify(messages).insertSelective(message.capture());
        assertThat(message.getValue().getSequenceNo()).isEqualTo(4);
        assertThat(message.getValue().getContent()).isEqualTo("海报已生成。");
        verify(sessions).updateLastMessageAt(101L, NOW);
    }

    @Test
    void returnsTheAuthoritativeTerminalSnapshotForAnIdempotentReplay() {
        CreationTask completed = running();
        completed.setStatus("FAILED");
        completed.setFailureCode("MODEL_UNAVAILABLE");
        completed.setRevision(1L);
        ConversationMessage assistant = new ConversationMessage();
        assistant.setContent("暂时无法完成。");
        when(creations.selectByIdForUpdate(151L)).thenReturn(completed);
        when(messages.selectAssistantByCreationTaskId(151L)).thenReturn(assistant);

        var response = service.complete(command("FAILED", "MODEL_UNAVAILABLE", "暂时无法完成。"));

        assertThat(response.failureCode()).isEqualTo("MODEL_UNAVAILABLE");
        verify(creations, never()).completeRunning(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void rejectsAConflictingTerminalReplay() {
        CreationTask completed = running();
        completed.setStatus("SUCCEEDED");
        completed.setRevision(1L);
        when(creations.selectByIdForUpdate(151L)).thenReturn(completed);

        assertThatThrownBy(() -> service.complete(command("FAILED", "MODEL_UNAVAILABLE", null)))
                .isInstanceOf(IllegalStateException.class);
    }

    private static AgentCompletionCommand command(String outcome, String failure, String message) {
        return new AgentCompletionCommand(1, "agent-151", "151", 0, outcome, failure, message, java.util.List.of());
    }

    private static CreationTask running() {
        CreationTask creation = new CreationTask();
        creation.setId(151L);
        creation.setSessionId(101L);
        creation.setMode("AGENT");
        creation.setStatus("RUNNING");
        creation.setRevision(0L);
        return creation;
    }
}
