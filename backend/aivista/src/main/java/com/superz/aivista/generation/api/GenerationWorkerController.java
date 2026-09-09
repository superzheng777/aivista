package com.superz.aivista.generation.api;

import com.superz.aivista.generation.config.GenerationWorkerApiProperties;
import com.superz.aivista.generation.message.GenerationCompletionCommand;
import com.superz.aivista.generation.message.GenerationCompletionResponse;
import com.superz.aivista.generation.dto.CreateAgentGenerationTaskRequest;
import com.superz.aivista.generation.dto.CreateGenerationTaskResponse;
import com.superz.aivista.generation.service.AgentGenerationTaskCreationService;
import com.superz.aivista.generation.service.GenerationCompletionService;
import com.superz.aivista.generation.service.AgentExecutionSnapshotService;
import com.superz.aivista.generation.message.AgentExecutionSnapshot;
import com.superz.aivista.generation.message.AgentCompletionCommand;
import com.superz.aivista.generation.message.AgentCompletionResponse;
import com.superz.aivista.generation.service.AgentCompletionService;
import com.superz.aivista.generation.message.AgentActivityCommand;
import com.superz.aivista.generation.message.AgentActivityResponse;
import com.superz.aivista.generation.service.AgentActivityService;
import com.superz.aivista.generation.service.AgentRealtimeProjectionService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Private worker callbacks; never exposed as a browser API. */
@RestController
@RequestMapping("/internal/generation-worker")
public class GenerationWorkerController {
    private static final String TOKEN_HEADER = "X-AiVista-Worker-Token";
    private final GenerationCompletionService completions;
    private final GenerationWorkerApiProperties properties;
    private final AgentGenerationTaskCreationService agentTasks;
    private final AgentExecutionSnapshotService agentSnapshots;
    private final AgentCompletionService agentCompletions;
    private final AgentActivityService agentActivities;
    private final AgentRealtimeProjectionService agentRealtime;

    public GenerationWorkerController(GenerationCompletionService completions,
            GenerationWorkerApiProperties properties, AgentGenerationTaskCreationService agentTasks,
            AgentExecutionSnapshotService agentSnapshots, AgentCompletionService agentCompletions,
            AgentActivityService agentActivities, AgentRealtimeProjectionService agentRealtime) {
        this.completions = completions;
        this.properties = properties;
        this.agentTasks = agentTasks;
        this.agentSnapshots = agentSnapshots;
        this.agentCompletions = agentCompletions;
        this.agentActivities = agentActivities;
        this.agentRealtime = agentRealtime;
    }

    @PostMapping("/agent-creations/{creationTaskId}/activities")
    public AgentActivityResponse submitAgentActivities(@RequestHeader(TOKEN_HEADER) String token,
            @PathVariable long creationTaskId, @RequestBody AgentActivityCommand command) {
        authenticate(token);
        if (!Long.toString(creationTaskId).equals(command.creationTaskId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Agent creation path does not match body");
        }
        return agentActivities.submit(command);
    }

    @GetMapping("/agent-creations/{creationTaskId}/execution")
    public AgentExecutionSnapshot getAgentExecution(@RequestHeader(TOKEN_HEADER) String token,
            @PathVariable long creationTaskId) {
        authenticate(token);
        return agentSnapshots.get(creationTaskId);
    }

    @PostMapping("/agent-creations/{creationTaskId}/completion")
    public AgentCompletionResponse completeAgent(@RequestHeader(TOKEN_HEADER) String token,
            @PathVariable long creationTaskId, @RequestBody AgentCompletionCommand command) {
        authenticate(token);
        if (!Long.toString(creationTaskId).equals(command.creationTaskId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Agent creation path does not match body");
        }
        AgentCompletionResponse response = agentCompletions.complete(command);
        agentRealtime.publishTerminal(creationTaskId, command.revision());
        return response;
    }

    @PostMapping("/completion")
    public GenerationCompletionResponse complete(@RequestHeader(TOKEN_HEADER) String token,
            @RequestBody GenerationCompletionCommand command) {
        authenticate(token);
        return completions.complete(command);
    }

    @PostMapping("/agent-creations/{creationTaskId}/generation-tasks")
    public CreateGenerationTaskResponse createAgentGenerationTask(
            @RequestHeader(TOKEN_HEADER) String token,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @PathVariable long creationTaskId,
            @RequestBody CreateAgentGenerationTaskRequest request) {
        authenticate(token);
        return agentTasks.create(creationTaskId, idempotencyKey, request);
    }

    private void authenticate(String supplied) {
        String expected = properties.token();
        if (expected == null || expected.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Worker API is not configured");
        }
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid worker token");
        }
    }
}
