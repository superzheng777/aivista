package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 在 Agent 命令最终无法投递时收敛仍在运行的 Creation。 */
@Service
public class AgentQueuedCreationFailureService {
    private final CreationTaskMapper creations;
    private final OutboxEventMapper outbox;

    public AgentQueuedCreationFailureService(CreationTaskMapper creations, OutboxEventMapper outbox) {
        this.creations = creations;
        this.outbox = outbox;
    }

    @Transactional
    public void failDelivery(long eventId, long creationTaskId, long revision, Instant now, String error) {
        if (outbox.markFailed(eventId, error) != 1) return;
        CreationTask creation = creations.selectByIdForUpdate(creationTaskId);
        if (creation == null || !"AGENT".equals(creation.getMode()) || !"RUNNING".equals(creation.getStatus())
                || creation.getRevision() == null || creation.getRevision() != revision) return;
        creations.completeRunning(creationTaskId, revision, "FAILED", "AGENT_QUEUE_DELIVERY_FAILED", now);
    }
}
