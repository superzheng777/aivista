package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.message.AgentExecutionSnapshot;
import com.superz.aivista.generation.model.GenerationImageObjectKeys;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** 读取 Agent Worker 所需数据；不暴露用户凭据、签名 URL 或无关业务字段。 */
@Service
public class AgentExecutionSnapshotService {
    private static final int HISTORY_MESSAGE_LIMIT = 12;
    private static final int HISTORY_CODE_POINT_LIMIT = 12_000;
    private final CreationTaskMapper creations;
    private final ConversationMessageMapper messages;
    private final CreationTaskInputAssetMapper creationInputs;
    private final ImageAssetMapper assets;

    public AgentExecutionSnapshotService(CreationTaskMapper creations, ConversationMessageMapper messages,
            CreationTaskInputAssetMapper creationInputs, ImageAssetMapper assets) {
        this.creations = creations;
        this.messages = messages;
        this.creationInputs = creationInputs;
        this.assets = assets;
    }

    public AgentExecutionSnapshot get(long creationTaskId) {
        var creation = creations.selectSnapshotById(creationTaskId);
        if (creation == null || !"AGENT".equals(creation.getMode())) {
            throw new IllegalArgumentException("Agent creation does not exist");
        }
        var userMessage = messages.selectUserByCreationTaskId(creationTaskId);
        if (userMessage == null || userMessage.getContent() == null) {
            throw new IllegalStateException("Agent creation user message is missing");
        }
        List<AgentExecutionSnapshot.HistoryMessage> history = recentHistory(
                creation.getSessionId(), userMessage.getSequenceNo());
        List<Long> ids = creationInputs.selectAssetIdsByCreationTaskId(creationTaskId);
        Map<Long, ImageAsset> byId = ids.isEmpty() ? Map.of() : assets.selectByAssetIds(ids).stream()
                .collect(Collectors.toMap(ImageAsset::getId, Function.identity()));
        List<AgentExecutionSnapshot.InputAsset> inputs = ids.stream()
                .map(id -> input(byId.get(id)))
                .toList();
        return new AgentExecutionSnapshot(1, creation.getId().toString(), creation.getRevision(),
                creation.getStatus(), creation.getSessionId().toString(), userMessage.getContent(), history, inputs);
    }

    private List<AgentExecutionSnapshot.HistoryMessage> recentHistory(long sessionId, Integer beforeSequenceNo) {
        if (beforeSequenceNo == null || beforeSequenceNo <= 1) return List.of();
        List<com.superz.aivista.generation.entity.ConversationMessage> recent =
                messages.selectRecentBeforeSequence(sessionId, beforeSequenceNo, HISTORY_MESSAGE_LIMIT);
        int remaining = HISTORY_CODE_POINT_LIMIT;
        List<AgentExecutionSnapshot.HistoryMessage> result = new java.util.ArrayList<>();
        for (var message : recent) {
            if (!("USER".equals(message.getRole()) || "ASSISTANT".equals(message.getRole()))
                    || message.getContent() == null || message.getContent().isBlank()) continue;
            String content = limitCodePoints(message.getContent().strip(), remaining);
            if (content.isEmpty()) break;
            result.add(new AgentExecutionSnapshot.HistoryMessage(message.getRole(), content));
            remaining -= content.codePointCount(0, content.length());
            if (remaining == 0) break;
        }
        java.util.Collections.reverse(result);
        return List.copyOf(result);
    }

    private static String limitCodePoints(String value, int limit) {
        if (value.codePointCount(0, value.length()) <= limit) return value;
        return value.substring(0, value.offsetByCodePoints(0, limit));
    }

    private static AgentExecutionSnapshot.InputAsset input(ImageAsset asset) {
        if (asset == null) throw new IllegalStateException("Agent creation input asset is missing");
        boolean generated = "GENERATED".equals(asset.getOrigin());
        String key = generated
                ? GenerationImageObjectKeys.fromStoredValue(asset.getObjectKey()).display()
                : asset.getOriginalObjectKey();
        String contentType = generated ? "image/webp" : asset.getContentType();
        return new AgentExecutionSnapshot.InputAsset(asset.getId().toString(), key, contentType,
                asset.getFileSize(), asset.getWidth(), asset.getHeight());
    }
}
