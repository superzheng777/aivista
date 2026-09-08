package com.superz.aivista.generation.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Shared secret used only by the TypeScript worker when calling internal generation endpoints. */
@ConfigurationProperties("app.generation.worker-api")
public record GenerationWorkerApiProperties(String token) {
}
