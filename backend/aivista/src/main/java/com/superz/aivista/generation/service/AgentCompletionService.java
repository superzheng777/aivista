package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.message.AgentCompletionCommand;
import com.superz.aivista.generation.message.AgentCompletionResponse;
import com.superz.aivista.generation.model.ConversationRole;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 原子提交 Agent 最终回复和 Creation 终态，不保存 Pi 原始 Session。 */
@Service
public class AgentCompletionService {
    private static final int MAX_FINAL_MESSAGE_CODE_POINTS = 8_000;
    private final CreationTaskMapper creations;
    private final ConversationMessageMapper messages;
    private final GenerationSessionMapper sessions;
    private final Clock clock;
    private final AgentActivityService activities;

    public AgentCompletionService(CreationTaskMapper creations, ConversationMessageMapper messages,
            GenerationSessionMapper sessions, Clock clock, AgentActivityService activities) {
        this.creations = creations;
        this.messages = messages;
        this.sessions = sessions;
        this.clock = clock;
        this.activities = activities;
    }

    @Transactional
    public AgentCompletionResponse complete(AgentCompletionCommand command) {
        long creationTaskId = validate(command);
        CreationTask creation = creations.selectByIdForUpdate(creationTaskId);
        if (creation == null || !"AGENT".equals(creation.getMode())) {
            throw new IllegalArgumentException("Agent creation does not exist");
        }
        if (!"RUNNING".equals(creation.getStatus())) {
            if (!expectedStatus(command.outcome()).equals(creation.getStatus())) {
                throw new IllegalStateException("Agent completion conflicts with the existing terminal state");
            }
            return response(creation);
        }
        if (creation.getRevision() != command.revision()) {
            throw new IllegalArgumentException("Agent completion revision is stale");
        }
        Instant now = clock.instant();
        activities.upsertLocked(creationTaskId, command.activities());
        String finalMessage = normalized(command.finalMessage());
        if (finalMessage != null) insertAssistant(creation, finalMessage, now);
        String status = expectedStatus(command.outcome());
        String failureCode = "FAILED".equals(status) ? command.failureCode() : null;
        if (creations.completeRunning(creationTaskId, command.revision(), status, failureCode, now) != 1) {
            throw new IllegalStateException("Cannot complete Agent creation " + creationTaskId);
        }
        creation.setStatus(status);
        creation.setFailureCode(failureCode);
        creation.setRevision(command.revision() + 1);
        return new AgentCompletionResponse(Long.toString(creationTaskId), status,
                creation.getRevision(), failureCode, finalMessage);
    }

    private void insertAssistant(CreationTask creation, String content, Instant now) {
        Integer last = messages.selectLastSequenceNoForUpdate(creation.getSessionId());
        ConversationMessage message = new ConversationMessage();
        message.setSessionId(creation.getSessionId());
        message.setCreationTaskId(creation.getId());
        message.setSequenceNo(last == null ? 1 : last + 1);
        message.setRole(ConversationRole.ASSISTANT.name());
        message.setContent(content);
        message.setCreatedAt(now);
        messages.insertSelective(message);
        sessions.updateLastMessageAt(creation.getSessionId(), now);
    }

    private AgentCompletionResponse response(CreationTask creation) {
        ConversationMessage assistant = messages.selectAssistantByCreationTaskId(creation.getId());
        return new AgentCompletionResponse(creation.getId().toString(), creation.getStatus(),
                creation.getRevision(), creation.getFailureCode(), assistant == null ? null : assistant.getContent());
    }

    private static long validate(AgentCompletionCommand command) {
        if (command == null) throw new IllegalArgumentException("Agent completion is required");
        long id = Long.parseLong(command.creationTaskId());
        if (command.contractVersion() != 1 || id <= 0 || command.revision() < 0
                || !command.completionId().equals("agent-" + id)
                || !List.of("SUCCEEDED", "FAILED", "CANCELLED").contains(command.outcome())
                || ("SUCCEEDED".equals(command.outcome()) && normalized(command.finalMessage()) == null)
                || ("FAILED".equals(command.outcome()) && normalized(command.failureCode()) == null)
                || (normalized(command.failureCode()) != null && command.failureCode().length() > 64)
                || (normalized(command.finalMessage()) != null
                    && command.finalMessage().codePointCount(0, command.finalMessage().length())
                        > MAX_FINAL_MESSAGE_CODE_POINTS)
                || command.activities() == null || command.activities().size() > 100) {
            throw new IllegalArgumentException("Invalid Agent completion");
        }
        return id;
    }

    private static String expectedStatus(String outcome) {
        return outcome;
    }

    private static String normalized(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip();
    }
}
