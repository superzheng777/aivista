package com.superz.aivista.generation.service;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.dto.ConversationMessageResponse;
import com.superz.aivista.generation.dto.ConversationTurnPageResponse;
import com.superz.aivista.generation.dto.ConversationTurnResponse;
import com.superz.aivista.generation.dto.NormalGenerationRequestResponse;
import com.superz.aivista.generation.dto.CreationActivityResponse;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.ConversationMessage;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.entity.CreationActivity;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.ConversationMessageMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.CreationActivityMapper;
import com.superz.aivista.generation.model.ConversationRole;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 查询当前用户某个生成会话的历史创作轮次。 */
@Service
public class GenerationSessionTurnQueryService {
    private static final int DEFAULT_LIMIT = 5;
    private static final int MAX_LIMIT = 5;

    private final GenerationSessionMapper sessionMapper;
    private final ConversationMessageMapper messageMapper;
    private final CreationTaskMapper creationTaskMapper;
    private final GenerationTaskMapper taskMapper;
    private final ImageAssetMapper imageAssetMapper;
    private final GenerationTaskQueryService taskQueryService;
    private final CreationActivityMapper activityMapper;

    /**
     * 注入会话归属校验、消息与任务批量查询，以及负责生成任务安全快照的服务。
     */
    public GenerationSessionTurnQueryService(GenerationSessionMapper sessionMapper,
            ConversationMessageMapper messageMapper, CreationTaskMapper creationTaskMapper,
            GenerationTaskMapper taskMapper,
            ImageAssetMapper imageAssetMapper, GenerationTaskQueryService taskQueryService,
            CreationActivityMapper activityMapper) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
        this.creationTaskMapper = creationTaskMapper;
        this.taskMapper = taskMapper;
        this.imageAssetMapper = imageAssetMapper;
        this.taskQueryService = taskQueryService;
        this.activityMapper = activityMapper;
    }

    /**
     * 查询会话的历史消息。数据库按最新消息倒序读取，响应前再反转为适合聊天界面展示的时间正序。
     */
    @Transactional(readOnly = true)
    public ConversationTurnPageResponse list(long userId, long sessionId, String before, Integer requestedLimit) {
        if (sessionMapper.selectOwnedById(sessionId, userId) == null) {
            throw new BusinessException(ErrorCode.GENERATION_RESOURCE_NOT_FOUND);
        }

        int limit = normalizeLimit(requestedLimit);
        Long beforeCreationTaskId = decodeCursor(before);
        List<CreationTask> newestFirst = creationTaskMapper.selectPageBySessionId(
                sessionId, beforeCreationTaskId, limit + 1);
        boolean hasMore = newestFirst.size() > limit;
        List<CreationTask> page = new ArrayList<>(newestFirst.subList(0, Math.min(limit, newestFirst.size())));
        String nextBefore = hasMore ? encodeCursor(page.getLast().getId()) : null;
        Collections.reverse(page);
        return new ConversationTurnPageResponse(toItems(page), nextBefore, hasMore);
    }

    /** 将页面中所有创作轮次关联的消息、任务和图片分批读取，避免逐条查询造成 N+1 问题。 */
    private List<ConversationTurnResponse> toItems(List<CreationTask> creationTasks) {
        if (creationTasks.isEmpty()) {
            return List.of();
        }
        List<Long> creationTaskIds = creationTasks.stream().map(CreationTask::getId).toList();
        Map<Long, List<ConversationMessage>> messagesByTaskId = messageMapper
                .selectByCreationTaskIds(creationTaskIds).stream()
                .collect(Collectors.groupingBy(ConversationMessage::getCreationTaskId));
        Map<Long, List<GenerationTask>> generationTasksByCreationTaskId = taskMapper
                .selectByCreationTaskIds(creationTaskIds).stream()
                .collect(Collectors.groupingBy(GenerationTask::getCreationTaskId));
        List<GenerationTask> allTasks = generationTasksByCreationTaskId.values().stream().flatMap(List::stream).toList();
        Map<Long, List<ImageAsset>> imagesByTaskId = imagesByTaskId(allTasks);
        Map<Long, List<CreationActivity>> activitiesByCreationTaskId = activityMapper
                .selectByCreationTaskIds(creationTaskIds).stream()
                .collect(Collectors.groupingBy(CreationActivity::getCreationTaskId));
        return creationTasks.stream()
                .map(creationTask -> toItem(creationTask,
                        messagesByTaskId.getOrDefault(creationTask.getId(), List.of()),
                        generationTasksByCreationTaskId.getOrDefault(creationTask.getId(), List.of()), imagesByTaskId,
                        activitiesByCreationTaskId.getOrDefault(creationTask.getId(), List.of())))
                .toList();
    }

    private ConversationMessage messageWithRole(List<ConversationMessage> messages, String role) {
        return messages.stream()
                .filter(message -> role.equals(message.getRole()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Creation task is missing its " + role + " message"));
    }

    private ConversationMessage optionalMessageWithRole(List<ConversationMessage> messages, String role) {
        return messages.stream().filter(message -> role.equals(message.getRole())).findFirst().orElse(null);
    }

    /** 批量读取任务图片，并按任务 ID 分组，供任务快照复用。 */
    private Map<Long, List<ImageAsset>> imagesByTaskId(Iterable<GenerationTask> tasks) {
        List<Long> taskIds = new ArrayList<>();
        for (GenerationTask task : tasks) {
            taskIds.add(task.getId());
        }
        if (taskIds.isEmpty()) {
            return Map.of();
        }
        return imageAssetMapper.selectByOriginTaskIds(taskIds).stream()
                .collect(Collectors.groupingBy(ImageAsset::getOriginTaskId));
    }

    /** 组装单个创作轮次；异常历史数据缺少生成任务时仍返回两侧消息。 */
    private ConversationTurnResponse toItem(CreationTask creationTask, List<ConversationMessage> messages,
            List<GenerationTask> tasks, Map<Long, List<ImageAsset>> imagesByTaskId,
            List<CreationActivity> activities) {
        ConversationMessage userMessage = messageWithRole(messages, ConversationRole.USER.name());
        ConversationMessage assistantMessage = optionalMessageWithRole(messages, ConversationRole.ASSISTANT.name());
        GenerationTask normalTask = "NORMAL".equals(creationTask.getMode()) && !tasks.isEmpty() ? tasks.getFirst() : null;
        return new ConversationTurnResponse(
                String.valueOf(creationTask.getId()), creationTask.getMode(),
                creationTask.getStatus(), creationTask.getFailureCode(), creationTask.getRevision(),
                responseOf(userMessage), assistantMessage == null ? null : responseOf(assistantMessage),
                normalTask == null ? null : new NormalGenerationRequestResponse(normalTask.getFinalNegativePrompt()),
                tasks.stream().map(task -> taskQueryService.snapshot(task,
                        imagesByTaskId.getOrDefault(task.getId(), List.of()))).toList(),
                activities.stream().map(this::responseOf).toList());
    }

    private CreationActivityResponse responseOf(CreationActivity activity) {
        return new CreationActivityResponse(activity.getActivityKey(), activity.getSequenceNo(),
                activity.getActivityType(), activity.getState(), activity.getContent(), activity.getToolName(),
                activity.getGenerationTaskId() == null ? null : activity.getGenerationTaskId().toString(),
                activity.getStartedAt(), activity.getCompletedAt());
    }

    private ConversationMessageResponse responseOf(ConversationMessage message) {
        return new ConversationMessageResponse(String.valueOf(message.getId()), message.getSequenceNo(),
                message.getRole(), message.getContent(), message.getCreatedAt());
    }

    /** 规范化分页大小；工作台当前每页固定最多返回 5 个创作轮次。 */
    private int normalizeLimit(Integer requestedLimit) {
        if (requestedLimit == null) {
            return DEFAULT_LIMIT;
        }
        if (requestedLimit < 1 || requestedLimit > MAX_LIMIT) {
            throw new BusinessException(ErrorCode.VALIDATION_ERROR);
        }
        return requestedLimit;
    }

    /** 将当前页最旧创作任务 ID 编码为 URL 安全的不透明游标。 */
    private String encodeCursor(long creationTaskId) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(String.valueOf(creationTaskId).getBytes(StandardCharsets.UTF_8));
    }

    /** 解码前端回传的游标；格式错误或非正 ID 统一视为无效请求。 */
    private Long decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            long creationTaskId = Long.parseLong(
                    new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8));
            if (creationTaskId < 1) {
                throw new NumberFormatException();
            }
            return creationTaskId;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.INVALID_CURSOR);
        }
    }
}
