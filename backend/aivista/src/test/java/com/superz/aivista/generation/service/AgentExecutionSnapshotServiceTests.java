package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class AgentExecutionSnapshotServiceTests {
    @Test
    void returnsPromptAndOrderedSafeInputObjects() {
        CreationTaskMapper creations = mock(CreationTaskMapper.class);
        ConversationMessageMapper messages = mock(ConversationMessageMapper.class);
        CreationTaskInputAssetMapper inputs = mock(CreationTaskInputAssetMapper.class);
        ImageAssetMapper assets = mock(ImageAssetMapper.class);
        CreationTask creation = new CreationTask();
        creation.setId(151L);
        creation.setSessionId(101L);
        creation.setMode("AGENT");
        creation.setStatus("RUNNING");
        creation.setRevision(0L);
        ConversationMessage user = new ConversationMessage();
        user.setContent("把这张图改成海报");
        user.setSequenceNo(5);
        ConversationMessage previousUser = history("USER", "上一轮请求", 3);
        ConversationMessage previousAssistant = history("ASSISTANT", "上一轮结果", 4);
        ImageAsset generated = asset(501L, "GENERATED", "users/7/tasks/20/0", "image/png");
        ImageAsset uploaded = asset(502L, "UPLOADED", "users/7/uploads/x/original.jpg", "image/jpeg");
        when(creations.selectSnapshotById(151L)).thenReturn(creation);
        when(messages.selectUserByCreationTaskId(151L)).thenReturn(user);
        when(messages.selectRecentBeforeSequence(101L, 5, 12))
                .thenReturn(new java.util.ArrayList<>(List.of(previousAssistant, previousUser)));
        when(inputs.selectAssetIdsByCreationTaskId(151L)).thenReturn(List.of(502L, 501L));
        when(assets.selectByAssetIds(List.of(502L, 501L))).thenReturn(List.of(generated, uploaded));

        var snapshot = new AgentExecutionSnapshotService(creations, messages, inputs, assets).get(151L);

        assertThat(snapshot.prompt()).isEqualTo("把这张图改成海报");
        assertThat(snapshot.history()).extracting(item -> item.role() + ":" + item.content())
                .containsExactly("USER:上一轮请求", "ASSISTANT:上一轮结果");
        assertThat(snapshot.inputAssets()).extracting(asset -> asset.assetId())
                .containsExactly("502", "501");
        assertThat(snapshot.inputAssets().get(0).objectKey()).isEqualTo("users/7/uploads/x/original.jpg");
        assertThat(snapshot.inputAssets().get(0).contentType()).isEqualTo("image/jpeg");
        assertThat(snapshot.inputAssets().get(1).objectKey()).isEqualTo("users/7/tasks/20/0/display.webp");
        assertThat(snapshot.inputAssets().get(1).contentType()).isEqualTo("image/webp");
    }

    private static ConversationMessage history(String role, String content, int sequence) {
        ConversationMessage message = new ConversationMessage();
        message.setRole(role);
        message.setContent(content);
        message.setSequenceNo(sequence);
        return message;
    }

    private static ImageAsset asset(long id, String origin, String key, String contentType) {
        ImageAsset asset = new ImageAsset();
        asset.setId(id);
        asset.setOrigin(origin);
        asset.setObjectKey(key);
        asset.setOriginalObjectKey(key);
        asset.setContentType(contentType);
        asset.setFileSize(100L);
        asset.setWidth(100);
        asset.setHeight(200);
        return asset;
    }
}
