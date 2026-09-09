package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.config.GenerationWorkerApiProperties;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.json.JsonMapper;

class AgentRuntimeWebSocketHandlerTests {
    private final AgentRealtimeProjectionService projection = Mockito.mock(AgentRealtimeProjectionService.class);
    private final AgentRuntimeWebSocketHandler handler = new AgentRuntimeWebSocketHandler(
            new GenerationWorkerApiProperties("worker-secret"), projection, JsonMapper.builder().build());

    @Test
    void requiresHelloThenForwardsOnlyTheNestedEvent() throws Exception {
        WebSocketSession session = session();
        handler.handleTextMessage(session,
                new TextMessage("{\"type\":\"HELLO\",\"contractVersion\":1,\"token\":\"worker-secret\"}"));
        handler.handleTextMessage(session, new TextMessage("""
                {"type":"EVENT","event":{"creationTaskId":31,"revision":4,"eventType":"TEXT_DELTA",
                "payload":{"contentIndex":0,"delta":"构图"}}}
                """));

        assertThat(session.getAttributes()).containsEntry(AgentRuntimeWebSocketHandler.AUTHENTICATED, true);
        verify(session).sendMessage(new TextMessage("{\"type\":\"READY\",\"contractVersion\":1}"));
        verify(projection).publish(Mockito.argThat(event -> event.creationTaskId() == 31L
                && "构图".equals(event.payload().get("delta"))));
    }

    @Test
    void closesAnUnauthenticatedConnectionWithoutForwarding() throws Exception {
        WebSocketSession session = session();
        handler.handleTextMessage(session,
                new TextMessage("{\"type\":\"HELLO\",\"contractVersion\":1,\"token\":\"wrong\"}"));
        verify(session).close(CloseStatus.POLICY_VIOLATION);
        verify(projection, never()).publish(Mockito.any());
    }

    private static WebSocketSession session() {
        WebSocketSession session = Mockito.mock(WebSocketSession.class);
        when(session.getAttributes()).thenReturn(new HashMap<>());
        return session;
    }
}
