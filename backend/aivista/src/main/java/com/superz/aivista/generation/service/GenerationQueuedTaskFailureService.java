package com.superz.aivista.generation.service;

import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.generation.mapper.UserGenerationDailyUsageMapper;
import com.superz.aivista.generation.model.GenerationFailureCode;
import com.superz.aivista.generation.model.GenerationTaskStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 将仍未被工作器领取的排队任务收敛为平台侧失败。
 *
 * <p>任务、每日额度和 Outbox 事件均以 MySQL 为权威来源。本服务通过行锁与条件更新处理
 * Outbox 投递失败、排队超时等竞争场景，确保任务只会进入一次终态，且平台侧额度最多返还一次。</p>
 */
@Service
public class GenerationQueuedTaskFailureService {
    private static final ZoneId QUOTA_ZONE = ZoneId.of("Asia/Shanghai");

    private final GenerationTaskMapper taskMapper;
    private final UserGenerationDailyUsageMapper dailyUsageMapper;
    private final OutboxEventMapper outboxEventMapper;

    public GenerationQueuedTaskFailureService(GenerationTaskMapper taskMapper,
            UserGenerationDailyUsageMapper dailyUsageMapper, OutboxEventMapper outboxEventMapper) {
        this.taskMapper = taskMapper;
        this.dailyUsageMapper = dailyUsageMapper;
        this.outboxEventMapper = outboxEventMapper;
    }

    @Transactional
    public boolean failIfStillQueued(long taskId, GenerationFailureCode failureCode, Instant now) {
        return failIfStillQueued(taskId, null, failureCode, now);
    }

    /**
     * 仅当任务仍处于 {@code QUEUED} 时收敛失败。
     *
     * <p>{@code expectedTaskVersion} 非空时，还会校验事件对应的任务版本，防止过期 Outbox
     * 事件错误地终止已发生后续状态变化的任务。</p>
     */
    private boolean failIfStillQueued(long taskId, Integer expectedTaskVersion,
            GenerationFailureCode failureCode, Instant now) {
        GenerationTask task = taskMapper.selectByIdForUpdate(taskId);
        if (task == null || !"QUEUED".equals(task.getStatus())
                || (expectedTaskVersion != null && !expectedTaskVersion.equals(task.getTaskVersion()))) {
            return false;
        }

        if (taskMapper.failQueued(taskId, task.getTaskVersion(), failureCode.name(), now, now) != 1) {
            return false;
        }
        // null意味着任务未被退回过额度
        refundAndPublish(task, now);
        return true;
    }

    private void refundAndPublish(GenerationTask task, Instant now) {
        if (task.getQuotaRefundedAt() == null) {
            LocalDate usageDate = LocalDate.ofInstant(task.getCreatedAt(), QUOTA_ZONE);
            if (dailyUsageMapper.refund(task.getUserId(), usageDate,
                    task.getRequestedImageCount(), now) != 1) {
                throw new IllegalStateException("Generation quota refund record is missing for task " + task.getId());
            }
        }
        outboxEventMapper.insertSelective(GenerationStatusOutboxEvent.create(
                task.getId(), task.getTaskVersion() + 1, GenerationTaskStatus.FAILED.name(),
                task.getAttemptCount() == null ? 0 : task.getAttemptCount(), now));
    }

    /**
     * 将 Outbox 事件的最终投递失败、任务失败与额度返还收敛为一个数据库事务。
     *
     * <p>只有事件仍处于 {@code PROCESSING} 时才会继续处理；任务版本不匹配、任务已被领取或
     * 已进入终态时，不会覆盖任务当前状态。</p>
     */
    @Transactional
    public void failDelivery(long eventId, long taskId, int taskVersion, Instant now, String error) {
        if (outboxEventMapper.markFailed(eventId, error) == 1) {
            failIfStillQueued(taskId, taskVersion, GenerationFailureCode.QUEUE_DELIVERY_FAILED, now);
        }
    }
}
