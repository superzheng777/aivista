package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.dto.GenerationSessionPageResponse;
import com.superz.aivista.generation.entity.GenerationSession;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.GenerationSessionMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GenerationSessionQueryServiceTests {
    @Test
    void returnsSummariesAndOneAdditionalCursorPage() {
        GenerationSessionMapper sessionMapper = mock(GenerationSessionMapper.class);
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        List<GenerationSession> sessions = List.of(session(3, "2026-07-30T03:00:00Z"),
                session(2, "2026-07-30T02:00:00Z"), session(1, "2026-07-30T01:00:00Z"));
        when(sessionMapper.selectPageByUserId(7L, null, null, 3)).thenReturn(sessions);
        when(taskMapper.selectLatestBySessionIds(List.of(3L, 2L))).thenReturn(List.of(task(301, 3, "QUEUED", 2)));
        when(taskMapper.selectActiveSessionIds(List.of(3L, 2L))).thenReturn(List.of(3L));

        GenerationSessionPageResponse response = service(sessionMapper, taskMapper).list(7L, null, 2);

        assertThat(response.hasMore()).isTrue();
        assertThat(response.nextCursor()).isNotBlank();
        assertThat(response.items()).extracting(item -> item.sessionId()).containsExactly("3", "2");
        assertThat(response.items().getFirst().latestTask().status()).isEqualTo("QUEUED");
        assertThat(response.items().getFirst().hasActiveTask()).isTrue();
        assertThat(response.items().get(1).latestTask()).isNull();
        assertThat(response.items().get(1).hasActiveTask()).isFalse();
        verify(taskMapper).selectLatestBySessionIds(List.of(3L, 2L));
        verify(taskMapper).selectActiveSessionIds(List.of(3L, 2L));
    }

    @Test
    void decodesCursorIntoStableDatabaseSortBoundary() {
        GenerationSessionMapper sessionMapper = mock(GenerationSessionMapper.class);
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        when(sessionMapper.selectPageByUserId(org.mockito.ArgumentMatchers.eq(7L),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(3L),
                org.mockito.ArgumentMatchers.eq(21))).thenReturn(List.of());

        service(sessionMapper, taskMapper).list(7L, "MTcyMjMwODQwMDAwMDoz", 20);

        ArgumentCaptor<Instant> instantCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(sessionMapper).selectPageByUserId(org.mockito.ArgumentMatchers.eq(7L), instantCaptor.capture(),
                org.mockito.ArgumentMatchers.eq(3L), org.mockito.ArgumentMatchers.eq(21));
        assertThat(instantCaptor.getValue()).isEqualTo(Instant.ofEpochMilli(1_722_308_400_000L));
    }

    @Test
    void rejectsMalformedCursorAndOutOfRangeLimit() {
        GenerationSessionQueryService service = service(mock(GenerationSessionMapper.class), mock(GenerationTaskMapper.class));

        assertThatThrownBy(() -> service.list(7L, "not-a-cursor", 20))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.INVALID_CURSOR));
        assertThatThrownBy(() -> service.list(7L, null, 51))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_ERROR));
    }

    private static GenerationSessionQueryService service(GenerationSessionMapper sessionMapper,
            GenerationTaskMapper taskMapper) {
        return new GenerationSessionQueryService(sessionMapper, taskMapper);
    }

    private static GenerationSession session(long id, String lastMessageAt) {
        GenerationSession session = new GenerationSession();
        session.setId(id);
        session.setTitle("会话 " + id);
        session.setLastMessageAt(Instant.parse(lastMessageAt));
        return session;
    }

    private static GenerationTask task(long id, long sessionId, String status, int taskVersion) {
        GenerationTask task = new GenerationTask();
        task.setId(id);
        task.setSessionId(sessionId);
        task.setStatus(status);
        task.setTaskVersion(taskVersion);
        return task;
    }
}
