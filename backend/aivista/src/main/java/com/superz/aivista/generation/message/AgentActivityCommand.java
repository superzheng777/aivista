package com.superz.aivista.generation.message;

import java.util.List;

public record AgentActivityCommand(int contractVersion, String creationTaskId, long revision,
        List<AgentActivityItem> activities) {
}
