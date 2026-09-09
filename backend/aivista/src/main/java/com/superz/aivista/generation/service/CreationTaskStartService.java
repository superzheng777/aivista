package com.superz.aivista.generation.service;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.CreationTaskInputAsset;
import com.superz.aivista.generation.entity.GenerationSession;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskInputAssetMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.model.ConversationRole;
import com.superz.aivista.generation.model.CreationTaskStatus;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;

/** 普通与 Agent 入口共用的 Session、Creation、用户消息持久化边界。 */
@Service
public class CreationTaskStartService {
    private final GenerationSessionMapper sessions;
    private final ConversationMessageMapper messages;
    private final CreationTaskMapper creations;
    private final CreationTaskInputAssetMapper creationInputs;

    public CreationTaskStartService(GenerationSessionMapper sessions, ConversationMessageMapper messages,
            CreationTaskMapper creations, CreationTaskInputAssetMapper creationInputs) {
        this.sessions = sessions;
        this.messages = messages;
        this.creations = creations;
        this.creationInputs = creationInputs;
    }

    public StartedCreation start(long userId, Long sessionId, String prompt, String mode,
            List<Long> inputAssetIds, boolean createAssistantPlaceholder, Instant now) {
        GenerationSession session = loadOrCreateSession(userId, sessionId, prompt, now);
        CreationTask creation = new CreationTask();
        creation.setUserId(userId);
        creation.setSessionId(session.getId());
        creation.setMode(mode);
        creation.setStatus(CreationTaskStatus.RUNNING.name());
        creation.setRevision(0L);
        creation.setCreatedAt(now);
        creation.setUpdatedAt(now);
        creations.insertSelective(creation);

        int userSequenceNo = nextMessageSequenceNo(sessionId, session.getId());
        insertMessage(session.getId(), creation.getId(), userSequenceNo, ConversationRole.USER.name(), prompt, now);
        if (createAssistantPlaceholder) {
            insertMessage(session.getId(), creation.getId(), userSequenceNo + 1,
                    ConversationRole.ASSISTANT.name(), null, now);
        }
        if (sessionId != null) sessions.updateLastMessageAt(session.getId(), now);
        persistInputs(creation.getId(), inputAssetIds, now);
        return new StartedCreation(session, creation);
    }

    private GenerationSession loadOrCreateSession(long userId, Long sessionId, String prompt, Instant now) {
        if (sessionId != null) {
            GenerationSession session = sessions.selectOwnedByIdForUpdate(sessionId, userId);
            if (session == null) throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
            return session;
        }
        GenerationSession session = new GenerationSession();
        session.setUserId(userId);
        session.setTitle(defaultTitle(prompt));
        session.setLastMessageAt(now);
        session.setCreatedAt(now);
        session.setUpdatedAt(now);
        sessions.insertSelective(session);
        return session;
    }

    private int nextMessageSequenceNo(Long requestedSessionId, long persistedSessionId) {
        if (requestedSessionId == null) return 1;
        Integer last = messages.selectLastSequenceNoForUpdate(persistedSessionId);
        return last == null ? 1 : last + 1;
    }

    private void insertMessage(long sessionId, long creationTaskId, int sequenceNo,
            String role, String content, Instant now) {
        ConversationMessage message = new ConversationMessage();
        message.setSessionId(sessionId);
        message.setCreationTaskId(creationTaskId);
        message.setSequenceNo(sequenceNo);
        message.setRole(role);
        message.setContent(content);
        message.setCreatedAt(now);
        messages.insertSelective(message);
    }

    private void persistInputs(long creationTaskId, List<Long> assetIds, Instant now) {
        for (int index = 0; index < assetIds.size(); index++) {
            CreationTaskInputAsset input = new CreationTaskInputAsset();
            input.setCreationTaskId(creationTaskId);
            input.setImageAssetId(assetIds.get(index));
            input.setSourceIndex(index);
            input.setCreatedAt(now);
            creationInputs.insertSelective(input);
        }
    }

    static Long parseSessionId(String value) {
        if (value == null) return null;
        try {
            long id = Long.parseLong(value);
            if (id <= 0 || !Long.toString(id).equals(value)) throw invalidSessionId();
            return id;
        } catch (NumberFormatException exception) {
            throw invalidSessionId();
        }
    }

    private static String defaultTitle(String prompt) {
        String title = prompt.strip();
        int end = title.offsetByCodePoints(0, Math.min(100, GenerationPromptValidator.codePointCount(title)));
        return title.substring(0, end);
    }

    private static BusinessException invalidSessionId() {
        return new BusinessException(ErrorCode.VALIDATION_ERROR, "sessionId：必须是正整数 ID");
    }

    public record StartedCreation(GenerationSession session, CreationTask creation) {
    }
}
