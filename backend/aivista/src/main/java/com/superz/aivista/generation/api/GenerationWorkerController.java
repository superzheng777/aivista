package com.superz.aivista.generation.api;

import com.superz.aivista.generation.config.GenerationWorkerApiProperties;
import com.superz.aivista.generation.message.GenerationCompletionCommand;
import com.superz.aivista.generation.message.GenerationCompletionResponse;
import com.superz.aivista.generation.service.GenerationCompletionService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Private worker callbacks; never exposed as a browser API. */
@RestController
@RequestMapping("/internal/generation-worker")
public class GenerationWorkerController {
    private static final String TOKEN_HEADER = "X-AiVista-Worker-Token";
    private final GenerationCompletionService completions;
    private final GenerationWorkerApiProperties properties;

    public GenerationWorkerController(GenerationCompletionService completions,
            GenerationWorkerApiProperties properties) {
        this.completions = completions;
        this.properties = properties;
    }

    @PostMapping("/completion")
    public GenerationCompletionResponse complete(@RequestHeader(TOKEN_HEADER) String token,
            @RequestBody GenerationCompletionCommand command) {
        authenticate(token);
        return completions.complete(command);
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
