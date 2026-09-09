package com.superz.aivista.generation.dto;

import java.time.Instant;

/** Java 已持久化并可靠排队的 Agent Creation。 */
public record CreateAgentCreationResponse(String creationTaskId, String sessionId,
        String status, long revision, Instant createdAt) {
}
