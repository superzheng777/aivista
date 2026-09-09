package com.superz.aivista.generation.message;

import java.time.Instant;

public record AgentActivityItem(String activityKey, String type, String state, String content,
        String toolName, String generationTaskId, Instant startedAt, Instant completedAt) {
}
