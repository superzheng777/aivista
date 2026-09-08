package com.superz.aivista.generation.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 显式声明生成命令交换机与持久化 Quorum Queue。 */
@Configuration
@ConditionalOnProperty(prefix = "app.generation.queue", name = "enabled", havingValue = "true")
public class GenerationRabbitConfiguration {
    @Bean
    DirectExchange generationCommandExchange(GenerationQueueProperties properties) {
        return ExchangeBuilder.directExchange(properties.exchange()).durable(true).build();
    }

    @Bean
    Queue generationTaskExecuteQueue(GenerationQueueProperties properties) {
        return QueueBuilder.durable(properties.generationName())
                .withArgument("x-queue-type", "quorum")
                .build();
    }

    @Bean
    Binding generationTaskExecuteBinding(@Qualifier("generationTaskExecuteQueue") Queue generationTaskExecuteQueue,
            @Qualifier("generationCommandExchange") DirectExchange generationCommandExchange,
            GenerationQueueProperties properties) {
        return BindingBuilder.bind(generationTaskExecuteQueue)
                .to(generationCommandExchange)
                .with(properties.generationRoutingKey());
    }

}
