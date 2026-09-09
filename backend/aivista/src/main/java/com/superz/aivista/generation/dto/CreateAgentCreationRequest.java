package com.superz.aivista.generation.dto;

import java.util.List;

/** 启动一次短生命周期 Agent Loop；生成参数由 Agent Tool 决定。 */
public record CreateAgentCreationRequest(String sessionId, String prompt, List<String> inputAssetIds) {
}
