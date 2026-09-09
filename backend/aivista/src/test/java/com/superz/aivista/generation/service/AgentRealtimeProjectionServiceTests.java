package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.event.AgentRealtimeEvent;
import com.superz.aivista.generation.event.AgentRealtimeInboundEvent;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class AgentRealtimeProjectionServiceTests {
    private final CreationTaskMapper creations = Mockito.mock(CreationTaskMapper.class);
    private final GenerationSseConnectionService connections = Mockito.mock(GenerationSseConnectionService.class);
    private final AgentRealtimeProjectionService service = new AgentRealtimeProjectionService(creations, connections);

    @Test
    void routesOnlyJavaVerifiedAgentEventsAndAssignsStableStreamSequence() {
        when(creations.selectSnapshotById(31L)).thenReturn(creation("AGENT", "RUNNING", 4L));

        assertThat(service.publish(event("TEXT_STARTED", Map.of("contentIndex", 0)))).isTrue();
        assertThat(service.publish(event("TEXT_DELTA", Map.of("contentIndex", 0, "delta", "构图")))).isTrue();

        ArgumentCaptor<AgentRealtimeEvent> events = ArgumentCaptor.forClass(AgentRealtimeEvent.class);
        verify(connections, Mockito.times(2)).publishAgent(Mockito.eq(7L), anyLong(), events.capture());
        assertThat(events.getAllValues()).extracting(AgentRealtimeEvent::sequence).containsExactly(1L, 2L);
        assertThat(events.getAllValues()).extracting(AgentRealtimeEvent::streamId).doesNotContainNull()
                .containsOnly(events.getAllValues().getFirst().streamId());
        assertThat(events.getAllValues().getFirst().sessionId()).isEqualTo(9L);
    }

    @Test
    void rejectsUnknownTypesAndStaleOrNonAgentCreations() {
        when(creations.selectSnapshotById(31L)).thenReturn(creation("AGENT", "RUNNING", 3L));
        assertThat(service.publish(event("PROVIDER_DEBUG", Map.of()))).isFalse();
        assertThat(service.publish(event("TEXT_DELTA", Map.of("delta", "old")))).isFalse();
        verify(connections, never()).publishAgent(anyLong(), anyLong(), Mockito.any());
    }

    @Test
    void publishesTheTerminalEventFromCommittedJavaStateAndClosesTheStream() {
        when(creations.selectSnapshotById(31L)).thenReturn(creation("AGENT", "RUNNING", 4L));
        service.publish(event("RUN_STARTED", Map.of()));
        CreationTask completed = creation("AGENT", "SUCCEEDED", 5L);
        when(creations.selectSnapshotById(31L)).thenReturn(completed);

        service.publishTerminal(31L, 4L);

        ArgumentCaptor<AgentRealtimeEvent> events = ArgumentCaptor.forClass(AgentRealtimeEvent.class);
        verify(connections, Mockito.times(2)).publishAgent(Mockito.eq(7L), anyLong(), events.capture());
        assertThat(events.getAllValues().getLast().eventType()).isEqualTo("RUN_FINISHED");
        assertThat(events.getAllValues().getLast().sequence()).isEqualTo(2L);
        assertThat(events.getAllValues().getLast().revision()).isEqualTo(5L);
    }

    @Test
    void emitsTheJavaCommittedTerminalEventOnTheExistingStream() {
        CreationTask running = creation("AGENT", "RUNNING", 4L);
        when(creations.selectSnapshotById(31L)).thenReturn(running);
        service.publish(event("RUN_STARTED", Map.of()));
        CreationTask completed = creation("AGENT", "SUCCEEDED", 5L);
        when(creations.selectSnapshotById(31L)).thenReturn(completed);

        service.publishTerminal(31L, 4L);

        ArgumentCaptor<AgentRealtimeEvent> events = ArgumentCaptor.forClass(AgentRealtimeEvent.class);
        verify(connections, Mockito.times(2)).publishAgent(Mockito.eq(7L), anyLong(), events.capture());
        assertThat(events.getAllValues().getLast().eventType()).isEqualTo("RUN_FINISHED");
        assertThat(events.getAllValues().getLast().sequence()).isEqualTo(2L);
        assertThat(events.getAllValues().getLast().revision()).isEqualTo(5L);
    }

    private AgentRealtimeInboundEvent event(String type, Map<String, Object> payload) {
        return new AgentRealtimeInboundEvent(31L, 4L, type, payload);
    }

    private static CreationTask creation(String mode, String status, long revision) {
        CreationTask creation = new CreationTask();
        creation.setId(31L);
        creation.setUserId(7L);
        creation.setSessionId(9L);
        creation.setMode(mode);
        creation.setStatus(status);
        creation.setRevision(revision);
        return creation;
    }
}
