package com.superz.aivista.generation.event;

import java.util.Map;

/** Safe transient Agent event received from the trusted TypeScript runtime. */
public record AgentRealtimeInboundEvent(
        long creationTaskId,
        long revision,
        String eventType,
        Map<String, Object> payload) {
}
