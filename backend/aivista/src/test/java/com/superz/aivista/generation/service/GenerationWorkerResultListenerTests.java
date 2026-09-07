package com.superz.aivista.generation.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doThrow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.superz.aivista.generation.message.GenerationWorkerResultMessage;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;

class GenerationWorkerResultListenerTests {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final GenerationWorkerResultService results = mock(GenerationWorkerResultService.class);
    private final Channel channel = mock(Channel.class);
    private final GenerationWorkerResultListener listener = new GenerationWorkerResultListener(objectMapper, results);

    @Test
    void appliesProviderSuccessContractBeforeAcknowledging() throws Exception {
        listener.consume(message(Files.readString(fixture("provider-succeeded.json"))), channel);
        verify(results).apply(org.mockito.ArgumentMatchers.argThat(result ->
                "PROVIDER".equals(result.phase()) && "101".equals(result.taskId())));
        verify(channel).basicAck(9L, false);
    }

    @Test
    void appliesTransferSuccessContractBeforeAcknowledging() throws Exception {
        listener.consume(message(Files.readString(fixture("transfer-succeeded.json"))), channel);
        verify(results).apply(org.mockito.ArgumentMatchers.argThat(result ->
                "TRANSFER".equals(result.phase()) && result.images().size() == 1));
        verify(channel).basicAck(9L, false);
    }

    @Test
    void rejectsMalformedResultsWithoutApplyingThem() throws Exception {
        listener.consume(message("{\"contractVersion\":2}"), channel);
        verify(results, never()).apply(org.mockito.ArgumentMatchers.any());
        verify(channel).basicReject(9L, false);
    }

    @Test
    void requeuesTransientJavaTransactionFailure() throws Exception {
        GenerationWorkerResultMessage result = objectMapper.readValue(
                Files.readString(fixture("provider-succeeded.json")), GenerationWorkerResultMessage.class);
        doThrow(new IllegalStateException("database unavailable")).when(results).apply(result);
        listener.consume(message(objectMapper.writeValueAsString(result)), channel);
        verify(channel).basicNack(9L, false, true);
    }

    private static Message message(String json) {
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(9L);
        return new Message(json.getBytes(StandardCharsets.UTF_8), properties);
    }

    private static Path fixture(String name) {
        return Path.of("..", "..", "contracts", "generation-worker", "v1", name);
    }
}
