package com.superz.aivista.generation.event;

import java.util.Map;

/** Browser-facing transient Agent event; Java owns routing and ordering metadata. */
public record AgentRealtimeEvent(
        long creationTaskId,
        long sessionId,
        long revision,
        String streamId,
        long sequence,
        String eventType,
        Map<String, Object> payload) {
}
