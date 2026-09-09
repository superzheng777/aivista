package com.superz.aivista.generation.message;

import java.util.List;

public record AgentActivityResponse(String creationTaskId, long revision, List<AgentActivityReceipt> activities) {
}
