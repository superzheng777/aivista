package com.superz.aivista.generation.config;

import com.aliyun.oss.ClientBuilderConfiguration;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 创建 Java Core 的资产上传、访问和清理所需的 OSS 客户端。 */
@Configuration
public class GenerationExecutionConfiguration {

    @Bean(destroyMethod = "shutdown")
    OSS generationOssClient(GenerationOssProperties properties) {
        ClientBuilderConfiguration configuration = new ClientBuilderConfiguration();
        configuration.setConnectionTimeout(toMilliseconds(properties.uploadConnectTimeout()));
        configuration.setSocketTimeout(toMilliseconds(properties.uploadReadTimeout()));
        return new OSSClientBuilder().build(
                properties.endpoint(),
                properties.accessKeyId(),
                properties.accessKeySecret(),
                configuration);
    }

    private static int toMilliseconds(Duration duration) {
        return Math.toIntExact(duration.toMillis());
    }
}
