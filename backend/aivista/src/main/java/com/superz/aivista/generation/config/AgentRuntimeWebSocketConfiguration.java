package com.superz.aivista.generation.config;

import com.superz.aivista.generation.service.AgentRuntimeWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Registers the single internal Java–TypeScript realtime channel. */
@Configuration
@EnableWebSocket
public class AgentRuntimeWebSocketConfiguration implements WebSocketConfigurer {
    private final AgentRuntimeWebSocketHandler handler;

    public AgentRuntimeWebSocketConfiguration(AgentRuntimeWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/internal/agent-runtime").setAllowedOrigins();
    }
}
