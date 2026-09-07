package com.superz.aivista.generation.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.superz.aivista.generation.message.GenerationWorkerResultMessage;
import java.util.List;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** Receives TypeScript execution results and delegates all core writes to Java. */
@Service
@ConditionalOnProperty(prefix = "app.generation.queue", name = "enabled", havingValue = "true")
public class GenerationWorkerResultListener {
    private final ObjectMapper objectMapper;
    private final GenerationWorkerResultService results;

    public GenerationWorkerResultListener(ObjectMapper objectMapper, GenerationWorkerResultService results) {
        this.objectMapper = objectMapper;
        this.results = results;
    }

    @RabbitListener(queues = "${app.generation.queue.worker-result-name}",
            containerFactory = "generationWorkerResultListenerContainerFactory")
    public void consume(Message message, Channel channel) throws Exception {
        long tag = message.getMessageProperties().getDeliveryTag();
        GenerationWorkerResultMessage result;
        try {
            result = objectMapper.readValue(message.getBody(), GenerationWorkerResultMessage.class);
            validate(result);
        } catch (Exception invalid) {
            channel.basicReject(tag, false);
            return;
        }
        try {
            results.apply(result);
            channel.basicAck(tag, false);
        } catch (IllegalArgumentException invalid) {
            channel.basicReject(tag, false);
        } catch (Exception transientFailure) {
            channel.basicNack(tag, false, true);
        }
    }

    private static void validate(GenerationWorkerResultMessage result) {
        if (result.contractVersion() != 1 || result.resultId() == null || result.resultId().isBlank()
                || Long.parseLong(result.taskId()) <= 0 || result.taskVersion() < 0
                || !List.of("PROVIDER", "TRANSFER").contains(result.phase())
                || !List.of("STARTED", "SUCCEEDED", "FAILED").contains(result.outcome())) {
            throw new IllegalArgumentException("Invalid generation worker result");
        }
        if ("FAILED".equals(result.outcome())) {
            GenerationFailureCodeValidator.validate(result.phase(), result.failureCode());
        } else if (result.failureCode() != null) {
            throw new IllegalArgumentException("Successful result cannot have a failure code");
        }
        if ("PROVIDER".equals(result.phase()) && "SUCCEEDED".equals(result.outcome())
                && (result.providerResultSnapshot() == null || result.declaredWidth() == null
                || result.declaredHeight() == null || result.expectedImageCount() == null)) {
            throw new IllegalArgumentException("Provider success payload is incomplete");
        }
        if ("TRANSFER".equals(result.phase()) && "SUCCEEDED".equals(result.outcome())
                && (result.expectedImageCount() == null || result.expectedImageCount() <= 0
                || result.images() == null)) {
            throw new IllegalArgumentException("Transfer success payload is incomplete");
        }
    }

    private static final class GenerationFailureCodeValidator {
        private static void validate(String phase, String value) {
            var code = com.superz.aivista.generation.model.GenerationFailureCode.valueOf(value);
            boolean transferCode = code == com.superz.aivista.generation.model.GenerationFailureCode.IMAGE_TRANSFER_FAILED
                    || code == com.superz.aivista.generation.model.GenerationFailureCode.IMAGE_TRANSFER_PARTIAL_FAILURE;
            if (("TRANSFER".equals(phase)) != transferCode) {
                throw new IllegalArgumentException("Failure code does not match result phase");
            }
        }
    }
}
