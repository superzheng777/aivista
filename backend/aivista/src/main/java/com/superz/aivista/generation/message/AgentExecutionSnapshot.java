package com.superz.aivista.generation.message;

import java.util.List;

/** TS 启动一个 Pi Loop 所需的最小权威快照。 */
public record AgentExecutionSnapshot(int contractVersion, String creationTaskId, long revision,
        String status, String sessionId, String prompt, List<HistoryMessage> history,
        List<InputAsset> inputAssets) {

    public record HistoryMessage(String role, String content) {
    }

    public record InputAsset(String assetId, String objectKey, String contentType,
            long fileSize, int width, int height) {
    }
}
