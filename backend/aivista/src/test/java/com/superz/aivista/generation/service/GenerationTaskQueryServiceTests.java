package com.superz.aivista.generation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.aliyun.oss.OSS;
import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.generation.config.GenerationOssProperties;
import com.superz.aivista.generation.config.GenerationBailianProperties;
import com.superz.aivista.generation.dto.GenerationTaskSnapshotResponse;
import com.superz.aivista.generation.entity.ImageAsset;
import com.superz.aivista.generation.entity.GenerationTask;
import com.superz.aivista.generation.mapper.ImageAssetMapper;
import com.superz.aivista.generation.mapper.GenerationTaskMapper;
import java.net.URL;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class GenerationTaskQueryServiceTests {
    private static final Instant NOW = Instant.parse("2026-07-29T02:00:00Z");

    @Test
    void returnsOnlySafeSnapshotFieldsAndSignsSucceededImages() throws Exception {
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        ImageAssetMapper imageMapper = mock(ImageAssetMapper.class);
        OSS ossClient = mock(OSS.class);
        GenerationTask task = task("SUCCEEDED");
        task.setCompletedImageCount(1);
        ImageAsset image = image();
        when(taskMapper.selectOwnedById(7L, 301L)).thenReturn(task);
        when(imageMapper.selectByOriginTaskId(301L)).thenReturn(List.of(image));
        when(ossClient.generatePresignedUrl(org.mockito.ArgumentMatchers.eq("private-bucket"),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(java.util.Date.from(NOW.plusSeconds(600)))))
                .thenAnswer(invocation -> new URL("https://oss.example/" + invocation.getArgument(1)));

        GenerationTaskSnapshotResponse response = service(taskMapper, imageMapper, ossClient).get(7L, 301L);

        assertThat(response.taskId()).isEqualTo("301");
        assertThat(response.sessionId()).isEqualTo("201");
        assertThat(response.failedImageCount()).isZero();
        assertThat(response.images()).singleElement().satisfies(result -> {
            assertThat(result.imageId()).isEqualTo("901");
            assertThat(result.sourceIndex()).isZero();
            assertThat(result.imageUrls().thumbnail().url()).endsWith("/card.webp");
            assertThat(result.imageUrls().display().url()).endsWith("/display.webp");
            assertThat(result.imageUrls().display().expiresAt()).isEqualTo(NOW.plusSeconds(600));
            assertThat(result.generationConfig().width()).isEqualTo(2048);
        });
        verify(imageMapper).selectByOriginTaskId(301L);
    }

    @Test
    void keepsDeletedImagePositionWithoutSigningItsUrl() {
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        ImageAssetMapper imageMapper = mock(ImageAssetMapper.class);
        OSS ossClient = mock(OSS.class);
        GenerationTask task = task("SUCCEEDED");
        task.setCompletedImageCount(1);
        ImageAsset image = image();
        image.setDeletedAt(NOW.minusSeconds(1));
        when(taskMapper.selectOwnedById(7L, 301L)).thenReturn(task);
        when(imageMapper.selectByOriginTaskId(301L)).thenReturn(List.of(image));

        GenerationTaskSnapshotResponse response = service(taskMapper, imageMapper, ossClient).get(7L, 301L);

        assertThat(response.images()).singleElement().satisfies(result -> {
            assertThat(result.imageId()).isEqualTo("901");
            assertThat(result.sourceIndex()).isZero();
            assertThat(result.imageUrls().thumbnail()).isNull();
            assertThat(result.imageUrls().display()).isNull();
        });
        verify(ossClient, org.mockito.Mockito.never()).generatePresignedUrl(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void returnsNoImagesForRunningTask() {
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        ImageAssetMapper imageMapper = mock(ImageAssetMapper.class);
        GenerationTask task = task("RUNNING");
        when(taskMapper.selectOwnedById(7L, 301L)).thenReturn(task);

        GenerationTaskSnapshotResponse response = service(taskMapper, imageMapper, mock(OSS.class)).get(7L, 301L);

        assertThat(response.images()).isEmpty();
        assertThat(response.failureCode()).isNull();
        assertThat(response.completedAt()).isNull();
    }

    @Test
    void hidesTasksThatDoNotBelongToCurrentUser() {
        GenerationTaskMapper taskMapper = mock(GenerationTaskMapper.class);
        when(taskMapper.selectOwnedById(7L, 301L)).thenReturn(null);

        assertThatThrownBy(() -> service(taskMapper, mock(ImageAssetMapper.class), mock(OSS.class)).get(7L, 301L))
                .isInstanceOfSatisfying(BusinessException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo(ErrorCode.GENERATION_RESOURCE_NOT_FOUND));
    }

    private static GenerationTaskQueryService service(GenerationTaskMapper taskMapper,
            ImageAssetMapper imageMapper, OSS ossClient) {
        return new GenerationTaskQueryService(taskMapper, imageMapper, ossClient,
                new GenerationOssProperties("oss.example", "private-bucket", "key-id", "key-secret", "users",
                        Duration.ofMinutes(10), Duration.ofSeconds(5), Duration.ofSeconds(60)),
                new GenerationBailianProperties(3),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static GenerationTask task(String status) {
        GenerationTask task = new GenerationTask();
        task.setId(301L);
        task.setUserId(7L);
        task.setSessionId(201L);
        task.setStatus(status);
        task.setTaskVersion(4);
        task.setRequestedImageCount(1);
        task.setCompletedImageCount(0);
        task.setWidth(2048);
        task.setHeight(2048);
        task.setPromptExtend(true);
        task.setCreatedAt(NOW.minusSeconds(30));
        return task;
    }

    private static ImageAsset image() {
        ImageAsset image = new ImageAsset();
        image.setId(901L);
        image.setObjectKey("users/7/tasks/301/0");
        image.setWidth(2048);
        image.setHeight(2048);
        image.setSourceIndex(0);
        return image;
    }
}
