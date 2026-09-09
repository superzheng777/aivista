package com.superz.aivista.generation.event;

/** Minimal instance-level WebSocket protocol. HELLO authenticates; EVENT carries one transient projection. */
public record AgentRealtimeWireFrame(
        String type,
        Integer contractVersion,
        String token,
        AgentRealtimeInboundEvent event) {
}
