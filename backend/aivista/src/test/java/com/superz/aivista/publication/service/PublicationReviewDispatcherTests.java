package com.superz.aivista.publication.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.OutboxEvent;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.OutboxEventMapper;
import com.superz.aivista.publication.model.PublicationViolation;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class PublicationReviewDispatcherTests {
    private static final Instant NOW = Instant.parse("2026-08-09T12:00:00Z");

    @Test
    void approvesWhenBothFieldsAreAllowed() {
        Fixture fixture = fixture(0);
        when(fixture.moderation.moderate("title", "publication-42-title")).thenReturn(allowed());
        when(fixture.moderation.moderate("description", "publication-42-description")).thenReturn(allowed());

        fixture.dispatcher.dispatch();

        verify(fixture.outcomes).approve(fixture.image, 7L);
        verify(fixture.outbox).markPublished(18L, NOW);
    }

    @Test
    void rejectsWithSafeFieldViolationWhenModerationBlocksTitle() {
        Fixture fixture = fixture(0);
        when(fixture.moderation.moderate("title", "publication-42-title"))
                .thenReturn(new PublicationTextModerationClient.ModerationResult(
                        "request-1", "high", List.of("personal_information")));
        when(fixture.moderation.moderate("description", "publication-42-description")).thenReturn(allowed());

        fixture.dispatcher.dispatch();

        verify(fixture.outcomes).reject(fixture.image, 7L,
                List.of(new PublicationViolation("title", "SENSITIVE_INFO")));
        verify(fixture.outbox).markPublished(18L, NOW);
    }

    @Test
    void reschedulesFirstProviderFailureWithoutFinalizingPublication() {
        Fixture fixture = fixture(0);
        when(fixture.moderation.moderate("title", "publication-42-title"))
                .thenThrow(new PublicationTextModerationException(new RuntimeException("timeout")));

        fixture.dispatcher.dispatch();

        verify(fixture.outbox).reschedule(18L, 1, NOW.plusSeconds(30), "PublicationTextModerationException");
        verify(fixture.outcomes, never()).fail(fixture.image, 7L);
    }

    @Test
    void recoversAnExpiredProcessingLeaseForTheCurrentReview() {
        Fixture fixture = fixtureWithoutAvailableEvent(0);
        when(fixture.outbox.selectProcessingLockedBefore("PUBLICATION_TEXT_REVIEW", NOW.minusSeconds(120), 20))
                .thenReturn(List.of(fixture.event));

        fixture.dispatcher.dispatch();

        verify(fixture.outbox).reschedule(18L, 1, NOW, "Publication review worker lease expired");
    }

    @Test
    void acknowledgesAStaleReviewWithoutCallingTheProvider() {
        Fixture fixture = fixture(0);
        fixture.image.setPublicationVersion(8L);

        fixture.dispatcher.dispatch();

        verify(fixture.outbox).markPublished(18L, NOW);
        verify(fixture.moderation, never()).moderate(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void marksImageFailedAndStopsAfterThirdProviderFailure() {
        OutboxEventMapper outbox = mock(OutboxEventMapper.class);
        ImageAssetMapper images = mock(ImageAssetMapper.class);
        PublicationTextModerationClient moderation = mock(PublicationTextModerationClient.class);
        PublicationReviewOutcomeService outcomes = mock(PublicationReviewOutcomeService.class);
        OutboxEvent event = reviewEvent(18L, 42L, 7L, 2);
        ImageAsset image = pendingImage(42L, 5L, 7L);
        when(outbox.selectAvailableByEventType("PUBLICATION_TEXT_REVIEW", NOW, 20)).thenReturn(List.of(event));
        when(outbox.claimPending(18L, NOW, NOW)).thenReturn(1);
        when(images.selectByAssetId(42L)).thenReturn(image);
        when(images.incrementPublicationReviewAttemptCount(42L, 7L)).thenReturn(1);
        when(moderation.moderate("title", "publication-42-title"))
                .thenThrow(new PublicationTextModerationException(new RuntimeException("timeout")));

        dispatcher(outbox, images, moderation, outcomes).dispatch();

        verify(outcomes).fail(image, 7L);
        verify(outbox).markFailed(18L, "PublicationTextModerationException");
    }

    private static Fixture fixture(int retryCount) {
        Fixture fixture = fixtureWithoutAvailableEvent(retryCount);
        when(fixture.outbox.selectAvailableByEventType("PUBLICATION_TEXT_REVIEW", NOW, 20))
                .thenReturn(List.of(fixture.event));
        when(fixture.outbox.claimPending(18L, NOW, NOW)).thenReturn(1);
        return fixture;
    }

    private static Fixture fixtureWithoutAvailableEvent(int retryCount) {
        OutboxEventMapper outbox = mock(OutboxEventMapper.class);
        ImageAssetMapper images = mock(ImageAssetMapper.class);
        PublicationTextModerationClient moderation = mock(PublicationTextModerationClient.class);
        PublicationReviewOutcomeService outcomes = mock(PublicationReviewOutcomeService.class);
        OutboxEvent event = reviewEvent(18L, 42L, 7L, retryCount);
        ImageAsset image = pendingImage(42L, 5L, 7L);
        when(images.selectByAssetId(42L)).thenReturn(image);
        when(images.incrementPublicationReviewAttemptCount(42L, 7L)).thenReturn(1);
        return new Fixture(outbox, images, moderation, outcomes, event, image,
                dispatcher(outbox, images, moderation, outcomes));
    }

    private static PublicationTextModerationClient.ModerationResult allowed() {
        return new PublicationTextModerationClient.ModerationResult("request-1", "none", List.of());
    }

    private static PublicationReviewDispatcher dispatcher(OutboxEventMapper outbox, ImageAssetMapper images,
            PublicationTextModerationClient moderation, PublicationReviewOutcomeService outcomes) {
        return new PublicationReviewDispatcher(outbox, images, moderation, outcomes, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static OutboxEvent reviewEvent(long id, long imageId, long version, int retryCount) {
        OutboxEvent event = new OutboxEvent();
        event.setId(id);
        event.setAggregateId(imageId);
        event.setAggregateVersion(version);
        event.setRetryCount(retryCount);
        return event;
    }

    private static ImageAsset pendingImage(long id, long userId, long version) {
        ImageAsset image = new ImageAsset();
        image.setId(id);
        image.setUserId(userId);
        image.setPublicationVersion(version);
        image.setPublicationReviewStatus("PENDING");
        image.setPublicationTitle("title");
        image.setPublicationDescription("description");
        return image;
    }

    private record Fixture(OutboxEventMapper outbox, ImageAssetMapper images,
            PublicationTextModerationClient moderation, PublicationReviewOutcomeService outcomes,
            OutboxEvent event, ImageAsset image, PublicationReviewDispatcher dispatcher) {
    }
}
