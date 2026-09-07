package com.superz.aivista.generation.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 显式声明生成命令交换机、两条持久化 Quorum Queue 及独立消费者容器。 */
@Configuration
@ConditionalOnProperty(prefix = "app.generation.queue", name = "enabled", havingValue = "true")
public class GenerationRabbitConfiguration {
    @Bean
    DirectExchange generationCommandExchange(GenerationQueueProperties properties) {
        return ExchangeBuilder.directExchange(properties.exchange()).durable(true).build();
    }

    @Bean
    DirectExchange generationDeadLetterExchange(GenerationQueueProperties properties) {
        return ExchangeBuilder.directExchange(properties.deadLetterExchange()).durable(true).build();
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

    @Bean
    Queue generationImageTransferQueue(GenerationQueueProperties properties) {
        return QueueBuilder.durable(properties.transferName())
                .withArgument("x-queue-type", "quorum")
                .build();
    }

    @Bean
    Binding generationImageTransferBinding(
            @Qualifier("generationImageTransferQueue") Queue generationImageTransferQueue,
            @Qualifier("generationCommandExchange") DirectExchange generationCommandExchange,
            GenerationQueueProperties properties) {
        return BindingBuilder.bind(generationImageTransferQueue)
                .to(generationCommandExchange)
                .with(properties.transferRoutingKey());
    }

    @Bean
    Queue generationWorkerResultQueue(GenerationQueueProperties properties) {
        return QueueBuilder.durable(properties.workerResultName())
                .withArgument("x-queue-type", "quorum")
                .deadLetterExchange(properties.deadLetterExchange())
                .deadLetterRoutingKey(properties.workerResultDeadLetterRoutingKey())
                .build();
    }

    @Bean
    Queue generationWorkerResultDeadLetterQueue(GenerationQueueProperties properties) {
        return QueueBuilder.durable(properties.workerResultDeadLetterName())
                .withArgument("x-queue-type", "quorum")
                .build();
    }

    @Bean
    Binding generationWorkerResultBinding(
            @Qualifier("generationWorkerResultQueue") Queue queue,
            @Qualifier("generationCommandExchange") DirectExchange exchange,
            GenerationQueueProperties properties) {
        return BindingBuilder.bind(queue).to(exchange).with(properties.workerResultRoutingKey());
    }

    @Bean
    Binding generationWorkerResultDeadLetterBinding(
            @Qualifier("generationWorkerResultDeadLetterQueue") Queue queue,
            @Qualifier("generationDeadLetterExchange") DirectExchange exchange,
            GenerationQueueProperties properties) {
        return BindingBuilder.bind(queue).to(exchange).with(properties.workerResultDeadLetterRoutingKey());
    }

    @Bean
    SimpleRabbitListenerContainerFactory generationWorkerResultListenerContainerFactory(
            ConnectionFactory connectionFactory, GenerationQueueProperties properties) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        factory.setConcurrentConsumers(properties.workerResultConsumerConcurrency());
        factory.setPrefetchCount(1);
        return factory;
    }
}
