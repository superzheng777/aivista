package com.superz.aivista.generation.dto;

import java.time.Instant;

public record CreationActivityResponse(String activityKey, int sequenceNo, String type, String state,
        String content, String toolName, String generationTaskId, Instant startedAt, Instant completedAt) {
}
