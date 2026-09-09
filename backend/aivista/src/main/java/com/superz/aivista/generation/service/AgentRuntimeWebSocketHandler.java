package com.superz.aivista.generation.service;

import com.superz.aivista.generation.config.GenerationWorkerApiProperties;
import com.superz.aivista.generation.event.AgentRealtimeWireFrame;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.json.JsonMapper;

/** Authenticated transport adapter. It owns no Agent business state. */
@Component
public class AgentRuntimeWebSocketHandler extends TextWebSocketHandler {
    static final String AUTHENTICATED = AgentRuntimeWebSocketHandler.class.getName() + ".authenticated";
    private static final int CONTRACT_VERSION = 1;
    private static final int MAX_FRAME_BYTES = 70 * 1024;

    private final GenerationWorkerApiProperties properties;
    private final AgentRealtimeProjectionService projection;
    private final JsonMapper json;

    public AgentRuntimeWebSocketHandler(GenerationWorkerApiProperties properties,
            AgentRealtimeProjectionService projection, JsonMapper json) {
        this.properties = properties;
        this.projection = projection;
        this.json = json;
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        if (message.getPayloadLength() > MAX_FRAME_BYTES) {
            session.close(CloseStatus.TOO_BIG_TO_PROCESS);
            return;
        }
        AgentRealtimeWireFrame frame;
        try {
            frame = json.readValue(message.getPayload(), AgentRealtimeWireFrame.class);
        } catch (RuntimeException exception) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }
        if (!Boolean.TRUE.equals(session.getAttributes().get(AUTHENTICATED))) {
            authenticate(session, frame);
            return;
        }
        if ("PING".equals(frame.type())) {
            session.sendMessage(new TextMessage("{\"type\":\"PONG\"}"));
            return;
        }
        if (!"EVENT".equals(frame.type()) || frame.event() == null) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }
        projection.publish(frame.event());
    }

    private void authenticate(WebSocketSession session, AgentRealtimeWireFrame frame) throws Exception {
        String expected = properties.token();
        String supplied = frame == null ? null : frame.token();
        boolean valid = frame != null && "HELLO".equals(frame.type())
                && frame.contractVersion() != null && frame.contractVersion() == CONTRACT_VERSION
                && expected != null && !expected.isBlank() && supplied != null
                && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                        supplied.getBytes(StandardCharsets.UTF_8));
        if (!valid) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        session.getAttributes().put(AUTHENTICATED, true);
        session.sendMessage(new TextMessage("{\"type\":\"READY\",\"contractVersion\":1}"));
    }
}
