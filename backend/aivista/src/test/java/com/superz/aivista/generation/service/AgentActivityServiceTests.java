package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.CreationActivity;
import com.superz.aivista.generation.entity.CreationTask;
import com.superz.aivista.generation.mapper.CreationActivityMapper;
import com.superz.aivista.generation.mapper.CreationTaskMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import com.superz.aivista.generation.message.AgentActivityCommand;
import com.superz.aivista.generation.message.AgentActivityItem;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AgentActivityServiceTests {
    private static final Instant STARTED = Instant.parse("2026-09-09T01:00:00Z");
    private static final Instant COMPLETED = Instant.parse("2026-09-09T01:01:00Z");
    private final CreationTaskMapper creations = mock(CreationTaskMapper.class);
    private final CreationActivityMapper activities = mock(CreationActivityMapper.class);
    private final GenerationTaskMapper generationTasks = mock(GenerationTaskMapper.class);
    private final AgentActivityService service = new AgentActivityService(creations, activities, generationTasks);

    @Test
    void assignsSequenceAndInsertsANewStableActivity() {
        when(creations.selectByIdForUpdate(151L)).thenReturn(running());
        when(activities.selectMaxSequenceNo(151L)).thenReturn(2);
        AgentActivityItem item = item("tool:call-1", "RUNNING", "正在执行文生图。", null);

        var response = service.submit(command(item));

        ArgumentCaptor<CreationActivity> inserted = ArgumentCaptor.forClass(CreationActivity.class);
        verify(activities).insertSelective(inserted.capture());
        assertThat(inserted.getValue().getSequenceNo()).isEqualTo(3);
        assertThat(inserted.getValue().getActivityKey()).isEqualTo("tool:call-1");
        assertThat(response.activities().getFirst().sequenceNo()).isEqualTo(3);
    }

    @Test
    void completesAnExistingRunningToolWithoutCreatingAnotherRow() {
        when(creations.selectByIdForUpdate(151L)).thenReturn(running());
        when(activities.selectMaxSequenceNo(151L)).thenReturn(1);
        CreationActivity existing = existingRunning();
        when(activities.selectByKey(151L, "tool:call-1")).thenReturn(existing);
        when(generationTasks.selectCreationTaskId(9001L)).thenReturn(151L);
        when(activities.completeRunning(71L, "COMPLETED", "文生图已完成。", 9001L, COMPLETED)).thenReturn(1);

        var response = service.submit(command(item("tool:call-1", "COMPLETED", "文生图已完成。", "9001")));

        assertThat(response.activities().getFirst().state()).isEqualTo("COMPLETED");
        verify(activities).completeRunning(71L, "COMPLETED", "文生图已完成。", 9001L, COMPLETED);
    }

    @Test
    void returnsAnIdenticalReplayAndRejectsAConflictingRewrite() {
        when(creations.selectByIdForUpdate(151L)).thenReturn(running());
        when(activities.selectMaxSequenceNo(151L)).thenReturn(1);
        CreationActivity existing = existingRunning();
        when(activities.selectByKey(151L, "tool:call-1")).thenReturn(existing);

        assertThat(service.submit(command(item("tool:call-1", "RUNNING", "正在执行文生图。", null)))
                .activities().getFirst().sequenceNo()).isEqualTo(1);
        assertThatThrownBy(() -> service.submit(command(new AgentActivityItem("tool:call-1", "NARRATION",
                "COMPLETED", "冲突内容", null, null, STARTED, COMPLETED))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsWritesAfterTheCreationIsTerminal() {
        CreationTask creation = running();
        creation.setStatus("SUCCEEDED");
        when(creations.selectByIdForUpdate(151L)).thenReturn(creation);

        assertThatThrownBy(() -> service.submit(command(item("tool:call-1", "RUNNING", "执行中", null))))
                .isInstanceOf(IllegalStateException.class);
    }

    private static AgentActivityCommand command(AgentActivityItem item) {
        return new AgentActivityCommand(1, "151", 0, List.of(item));
    }

    private static AgentActivityItem item(String key, String state, String content, String taskId) {
        return new AgentActivityItem(key, "TOOL", state, content, "text_to_image", taskId, STARTED,
                "RUNNING".equals(state) ? null : COMPLETED);
    }

    private static CreationTask running() {
        CreationTask creation = new CreationTask();
        creation.setId(151L);
        creation.setMode("AGENT");
        creation.setStatus("RUNNING");
        creation.setRevision(0L);
        return creation;
    }

    private static CreationActivity existingRunning() {
        CreationActivity activity = new CreationActivity();
        activity.setId(71L);
        activity.setCreationTaskId(151L);
        activity.setSequenceNo(1);
        activity.setActivityType("TOOL");
        activity.setActivityKey("tool:call-1");
        activity.setState("RUNNING");
        activity.setContent("正在执行文生图。");
        activity.setToolName("text_to_image");
        activity.setStartedAt(STARTED);
        return activity;
    }
}
