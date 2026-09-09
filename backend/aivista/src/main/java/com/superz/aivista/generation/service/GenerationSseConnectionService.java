package com.superz.aivista.generation.service;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.config.GenerationSseProperties;
import com.superz.aivista.generation.event.GenerationTaskStatusEvent;
import com.superz.aivista.generation.event.AgentRealtimeEvent;
import com.superz.aivista.publication.event.PublicationStatusEvent;
import com.superz.aivista.user.event.InteractionNotificationCreatedEvent;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 在单个应用实例内维护已认证用户的 SSE 连接。 */
@Service
public class GenerationSseConnectionService {
    private final Map<Long, Map<String, SseEmitter>> connectionsByUser = new ConcurrentHashMap<>();
    private final AtomicInteger activeConnectionCount = new AtomicInteger();
    private final GenerationSseProperties properties;
    private final Clock clock;

    public GenerationSseConnectionService(GenerationSseProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    /** 建立一条最长不超过当前 Access Token 剩余有效期的 SSE 连接。 */
    public SseEmitter connect(long userId, Instant tokenExpiresAt) {
        long timeout = Math.max(1, Duration.between(clock.instant(), tokenExpiresAt).toMillis());
        SseEmitter emitter = new SseEmitter(timeout);
        String connectionId = UUID.randomUUID().toString();
        register(userId, connectionId, emitter);
        emitter.onCompletion(() -> remove(userId, connectionId, emitter));
        emitter.onTimeout(() -> remove(userId, connectionId, emitter));
        emitter.onError(ignored -> remove(userId, connectionId, emitter));
        sendReady(userId, connectionId, emitter);
        return emitter;
    }

    /** 向当前实例中该用户的全部在线页面发送同一状态通知。 */
    public void publish(long userId, long eventId, GenerationTaskStatusEvent event) {
        publish(userId, eventId, "generation.task.updated", event);
    }

    public void publish(long userId, long eventId, PublicationStatusEvent event) {
        publish(userId, eventId, "publication.updated", event);
    }

    public void publish(long userId, long eventId, InteractionNotificationCreatedEvent event) {
        publish(userId, eventId, "interaction.notification.created", event);
    }

    public void publishAgent(long userId, long eventId, AgentRealtimeEvent event) {
        publish(userId, eventId, "agent.creation.event", event);
    }

    private void publish(long userId, long eventId, String eventName, Object event) {
        for (Map.Entry<String, SseEmitter> connection : snapshot(userId)) {
            try {
                connection.getValue().send(SseEmitter.event()
                        .id(String.valueOf(eventId))
                        .name(eventName)
                        .data(event, MediaType.APPLICATION_JSON));
            } catch (IOException | IllegalStateException exception) {
                remove(userId, connection.getKey(), connection.getValue());
            }
        }
    }

    /** 通过 SSE 注释心跳探测已断开的浏览器连接。 */
    @Scheduled(fixedDelayString = "${app.generation.sse.heartbeat-interval}")
    public void sendHeartbeats() {
        for (Map.Entry<Long, Map<String, SseEmitter>> user : connectionsByUser.entrySet()) {
            for (Map.Entry<String, SseEmitter> connection : new ArrayList<>(user.getValue().entrySet())) {
                sendComment(user.getKey(), connection.getKey(), connection.getValue(), "heartbeat");
            }
        }
    }

    int activeConnectionCount() {
        return activeConnectionCount.get();
    }

    private synchronized void register(long userId, String connectionId, SseEmitter emitter) {
        if (activeConnectionCount.get() >= properties.maxConnections()) {
            throw new BusinessException(ErrorCode.RATE_LIMITED, "SSE 连接数量已达上限");
        }
        Map<String, SseEmitter> userConnections = connectionsByUser.computeIfAbsent(userId,
                ignored -> new ConcurrentHashMap<>());
        if (userConnections.size() >= properties.maxConnectionsPerUser()) {
            throw new BusinessException(ErrorCode.RATE_LIMITED, "当前用户的 SSE 连接数量已达上限");
        }
        userConnections.put(connectionId, emitter);
        activeConnectionCount.incrementAndGet();
    }

    private void sendComment(long userId, String connectionId, SseEmitter emitter, String comment) {
        try {
            emitter.send(SseEmitter.event().comment(comment));
        } catch (IOException | IllegalStateException exception) {
            remove(userId, connectionId, emitter);
        }
    }

    private void sendReady(long userId, String connectionId, SseEmitter emitter) {
        try {
            emitter.send(SseEmitter.event().name("generation.stream.ready").data("{}", MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException exception) {
            remove(userId, connectionId, emitter);
        }
    }

    private ArrayList<Map.Entry<String, SseEmitter>> snapshot(long userId) {
        Map<String, SseEmitter> connections = connectionsByUser.get(userId);
        return connections == null ? new ArrayList<>() : new ArrayList<>(connections.entrySet());
    }

    private synchronized void remove(long userId, String connectionId, SseEmitter emitter) {
        Map<String, SseEmitter> userConnections = connectionsByUser.get(userId);
        if (userConnections == null || !userConnections.remove(connectionId, emitter)) {
            return;
        }
        activeConnectionCount.decrementAndGet();
        if (userConnections.isEmpty()) {
            connectionsByUser.remove(userId, userConnections);
        }
    }
}
