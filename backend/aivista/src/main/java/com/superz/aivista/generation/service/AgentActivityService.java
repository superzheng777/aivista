package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.CreationActivity;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.mapper.CreationActivityMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.message.AgentActivityCommand;
import com.superz.aivista.generation.message.AgentActivityItem;
import com.superz.aivista.generation.message.AgentActivityReceipt;
import com.superz.aivista.generation.message.AgentActivityResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 幂等提交少量、用户可见的稳定 Agent Activity。 */
@Service
public class AgentActivityService {
    private static final int MAX_BATCH_SIZE = 20;
    private final CreationTaskMapper creations;
    private final CreationActivityMapper activities;
    private final GenerationTaskMapper generationTasks;

    public AgentActivityService(CreationTaskMapper creations, CreationActivityMapper activities,
            GenerationTaskMapper generationTasks) {
        this.creations = creations;
        this.activities = activities;
        this.generationTasks = generationTasks;
    }

    @Transactional
    public AgentActivityResponse submit(AgentActivityCommand command) {
        long creationTaskId = validateCommand(command);
        CreationTask creation = creations.selectByIdForUpdate(creationTaskId);
        if (creation == null || !"AGENT".equals(creation.getMode())) {
            throw new IllegalArgumentException("Agent creation does not exist");
        }
        if (!"RUNNING".equals(creation.getStatus()) || creation.getRevision() != command.revision()) {
            throw new IllegalStateException("Agent creation is no longer writable");
        }
        return new AgentActivityResponse(Long.toString(creationTaskId), creation.getRevision(),
                upsertLocked(creationTaskId, command.activities()));
    }

    List<AgentActivityReceipt> upsertLocked(long creationTaskId, List<AgentActivityItem> items) {
        if (items == null || items.size() > 100) throw new IllegalArgumentException("Invalid Agent activities");
        if (items.isEmpty()) return List.of();
        int nextSequence = activities.selectMaxSequenceNo(creationTaskId) + 1;
        List<AgentActivityReceipt> receipts = new ArrayList<>(items.size());
        for (AgentActivityItem item : items) {
            validateItem(item);
            validateGenerationTask(creationTaskId, item.generationTaskId());
            CreationActivity existing = activities.selectByKey(creationTaskId, item.activityKey());
            if (existing == null) {
                CreationActivity inserted = entity(creationTaskId, nextSequence++, item);
                activities.insertSelective(inserted);
                receipts.add(receipt(inserted));
                continue;
            }
            if (same(existing, item)) {
                receipts.add(receipt(existing));
                continue;
            }
            if (!"RUNNING".equals(existing.getState()) || "RUNNING".equals(item.state())
                    || !Objects.equals(existing.getActivityType(), item.type())
                    || !Objects.equals(existing.getToolName(), item.toolName())) {
                throw new IllegalStateException("Agent activity conflicts with its existing state");
            }
            Long generationTaskId = parseOptionalId(item.generationTaskId());
            if (activities.completeRunning(existing.getId(), item.state(), item.content(),
                    generationTaskId, item.completedAt()) != 1) {
                throw new IllegalStateException("Cannot complete Agent activity " + item.activityKey());
            }
            existing.setState(item.state());
            existing.setContent(item.content());
            existing.setGenerationTaskId(generationTaskId);
            existing.setCompletedAt(item.completedAt());
            receipts.add(receipt(existing));
        }
        return receipts;
    }

    private static long validateCommand(AgentActivityCommand command) {
        if (command == null || command.contractVersion() != 1 || command.revision() < 0
                || command.activities() == null || command.activities().isEmpty()
                || command.activities().size() > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException("Invalid Agent activity command");
        }
        long id = parseId(command.creationTaskId());
        if (id <= 0) throw new IllegalArgumentException("Invalid Agent activity command");
        return id;
    }

    private static void validateItem(AgentActivityItem item) {
        if (item == null || blank(item.activityKey()) || item.activityKey().length() > 128
                || !List.of("NARRATION", "SKILL", "TOOL").contains(item.type())
                || !List.of("RUNNING", "COMPLETED", "FAILED").contains(item.state())
                || blank(item.content()) || item.content().codePointCount(0, item.content().length()) > 1_000
                || (item.toolName() != null && (blank(item.toolName()) || item.toolName().length() > 64))
                || item.startedAt() == null
                || ("RUNNING".equals(item.state()) && item.completedAt() != null)
                || (!"RUNNING".equals(item.state()) && item.completedAt() == null)
                || (item.completedAt() != null && item.completedAt().isBefore(item.startedAt()))) {
            throw new IllegalArgumentException("Invalid Agent activity");
        }
        parseOptionalId(item.generationTaskId());
    }

    private static CreationActivity entity(long creationTaskId, int sequence, AgentActivityItem item) {
        CreationActivity activity = new CreationActivity();
        activity.setCreationTaskId(creationTaskId);
        activity.setSequenceNo(sequence);
        activity.setActivityType(item.type());
        activity.setActivityKey(item.activityKey());
        activity.setState(item.state());
        activity.setContent(item.content());
        activity.setToolName(item.toolName());
        activity.setGenerationTaskId(parseOptionalId(item.generationTaskId()));
        activity.setStartedAt(item.startedAt());
        activity.setCompletedAt(item.completedAt());
        return activity;
    }

    private static boolean same(CreationActivity existing, AgentActivityItem item) {
        return Objects.equals(existing.getActivityType(), item.type())
                && Objects.equals(existing.getState(), item.state())
                && Objects.equals(existing.getContent(), item.content())
                && Objects.equals(existing.getToolName(), item.toolName())
                && Objects.equals(existing.getGenerationTaskId(), parseOptionalId(item.generationTaskId()))
                && Objects.equals(existing.getStartedAt(), item.startedAt())
                && Objects.equals(existing.getCompletedAt(), item.completedAt());
    }

    private static AgentActivityReceipt receipt(CreationActivity activity) {
        return new AgentActivityReceipt(activity.getActivityKey(), activity.getSequenceNo(), activity.getState());
    }

    private static long parseId(String value) {
        try { return Long.parseLong(value); }
        catch (RuntimeException exception) { throw new IllegalArgumentException("Invalid numeric ID", exception); }
    }

    private static Long parseOptionalId(String value) {
        if (value == null) return null;
        long id = parseId(value);
        if (id <= 0) throw new IllegalArgumentException("Invalid numeric ID");
        return id;
    }

    private void validateGenerationTask(long creationTaskId, String value) {
        Long taskId = parseOptionalId(value);
        if (taskId != null && !Objects.equals(generationTasks.selectCreationTaskId(taskId), creationTaskId)) {
            throw new IllegalArgumentException("Generation task does not belong to Agent creation");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
