package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.event.AgentRealtimeEvent;
import com.superz.aivista.generation.event.AgentRealtimeInboundEvent;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Service;

/** Validates trusted-runtime events and adds the Java-owned browser routing envelope. */
@Service
public class AgentRealtimeProjectionService {
    private static final Set<String> ALLOWED_TYPES = Set.of(
            "RUN_STARTED", "TEXT_STARTED", "TEXT_DELTA", "TEXT_FINISHED",
            "SKILL_SELECTED", "TOOL_STARTED", "TOOL_PROGRESS", "TOOL_FINISHED");

    private final CreationTaskMapper creationTasks;
    private final GenerationSseConnectionService connections;
    private final Map<StreamKey, StreamState> streams = new ConcurrentHashMap<>();
    private final AtomicLong eventIds = new AtomicLong();

    public AgentRealtimeProjectionService(CreationTaskMapper creationTasks,
            GenerationSseConnectionService connections) {
        this.creationTasks = creationTasks;
        this.connections = connections;
    }

    public boolean publish(AgentRealtimeInboundEvent inbound) {
        if (!ALLOWED_TYPES.contains(inbound.eventType()) || inbound.payload() == null) return false;
        CreationTask creation = creationTasks.selectSnapshotById(inbound.creationTaskId());
        if (creation == null || !"AGENT".equals(creation.getMode()) || !"RUNNING".equals(creation.getStatus())
                || creation.getRevision() == null || creation.getRevision() != inbound.revision()) {
            return false;
        }
        StreamKey key = new StreamKey(inbound.creationTaskId(), inbound.revision());
        StreamState stream = streams.computeIfAbsent(key,
                ignored -> new StreamState(UUID.randomUUID().toString(), new AtomicLong()));
        AgentRealtimeEvent event = new AgentRealtimeEvent(inbound.creationTaskId(), creation.getSessionId(),
                inbound.revision(), stream.streamId(), stream.sequence().incrementAndGet(), inbound.eventType(),
                Map.copyOf(inbound.payload()));
        connections.publishAgent(creation.getUserId(), eventIds.incrementAndGet(), event);
        return true;
    }

    /** Called only after the Agent completion transaction has returned successfully. */
    public void publishTerminal(long creationTaskId, long executionRevision) {
        CreationTask creation = creationTasks.selectSnapshotById(creationTaskId);
        if (creation == null || !"AGENT".equals(creation.getMode()) || creation.getRevision() == null
                || creation.getRevision() != executionRevision + 1
                || !("SUCCEEDED".equals(creation.getStatus()) || "FAILED".equals(creation.getStatus())
                    || "CANCELLED".equals(creation.getStatus()))) return;
        StreamKey key = new StreamKey(creationTaskId, executionRevision);
        StreamState stream = streams.computeIfAbsent(key,
                ignored -> new StreamState(UUID.randomUUID().toString(), new AtomicLong()));
        String eventType = "SUCCEEDED".equals(creation.getStatus()) ? "RUN_FINISHED" : "RUN_FAILED";
        AgentRealtimeEvent event = new AgentRealtimeEvent(creationTaskId, creation.getSessionId(),
                creation.getRevision(), stream.streamId(), stream.sequence().incrementAndGet(), eventType,
                Map.of("status", creation.getStatus()));
        connections.publishAgent(creation.getUserId(), eventIds.incrementAndGet(), event);
        streams.remove(key, stream);
    }

    private record StreamKey(long creationTaskId, long revision) {
    }

    private record StreamState(String streamId, AtomicLong sequence) {
    }
}
