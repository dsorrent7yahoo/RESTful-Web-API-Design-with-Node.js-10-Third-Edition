package com.healthcare.api.service;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanResponse;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.*;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class SqsService {

    private final SqsClient sqs;
    private final DynamoDbClient dynamo;
    private final AppProperties props;

    private String queueUrl() { return props.getAws().getSqs().getQueueUrl(); }
    private String dlqUrl() { return props.getAws().getSqs().getDlqQueueUrl(); }

    public Map<String, Object> getMessages(int max) {
        ReceiveMessageResponse resp = sqs.receiveMessage(ReceiveMessageRequest.builder()
            .queueUrl(queueUrl())
            .maxNumberOfMessages(Math.min(max, 10))
            .waitTimeSeconds(1)
            .messageAttributeNames("All")
            .attributeNamesWithStrings("All")
            .build());
        List<Map<String, Object>> messages = resp.messages().stream().map(m -> {
            Object body;
            try { body = new com.fasterxml.jackson.databind.ObjectMapper().readValue(m.body(), Map.class); }
            catch (Exception e) { body = m.body(); }
            return Map.<String, Object>of(
                "messageId", m.messageId(),
                "receiptHandle", m.receiptHandle(),
                "body", body,
                "sentAt", m.attributes().getOrDefault("SentTimestamp", "")
            );
        }).collect(Collectors.toList());
        return Map.of("messages", messages, "count", messages.size());
    }

    public Map<String, Object> purge() {
        sqs.purgeQueue(PurgeQueueRequest.builder().queueUrl(queueUrl()).build());
        return Map.of("status", "ok", "message", "queue purged");
    }

    public Map<String, Object> deleteMessage(String receiptHandle) {
        sqs.deleteMessage(DeleteMessageRequest.builder()
            .queueUrl(queueUrl()).receiptHandle(receiptHandle).build());
        return Map.of("status", "ok", "message", "message deleted");
    }

    public Map<String, Object> getStats() {
        GetQueueAttributesResponse resp = sqs.getQueueAttributes(
            GetQueueAttributesRequest.builder()
                .queueUrl(queueUrl())
                .attributeNamesWithStrings("All")
                .build());
        Map<String, String> attrs = resp.attributesAsStrings();
        return Map.of(
            "available", Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessages", "0")),
            "inFlight", Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessagesNotVisible", "0")),
            "lastModified", attrs.getOrDefault("LastModifiedTimestamp", ""),
            "queueUrl", queueUrl()
        );
    }

    public Map<String, Object> getDlqStats() {
        GetQueueAttributesResponse resp = sqs.getQueueAttributes(
            GetQueueAttributesRequest.builder()
                .queueUrl(dlqUrl())
                .attributeNamesWithStrings("All")
                .build());
        Map<String, String> attrs = resp.attributesAsStrings();
        return Map.of(
            "available", Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessages", "0")),
            "inFlight", Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessagesNotVisible", "0")),
            "lastModified", attrs.getOrDefault("LastModifiedTimestamp", ""),
            "queueUrl", dlqUrl()
        );
    }

    public Map<String, Object> getDlqMessages(int max) {
        ReceiveMessageResponse resp = sqs.receiveMessage(ReceiveMessageRequest.builder()
            .queueUrl(dlqUrl())
            .maxNumberOfMessages(Math.min(max, 10))
            .waitTimeSeconds(1)
            .build());
        List<Map<String, Object>> messages = resp.messages().stream().map(m -> {
            Object body;
            try { body = new com.fasterxml.jackson.databind.ObjectMapper().readValue(m.body(), Map.class); }
            catch (Exception e) { body = m.body(); }
            return Map.<String, Object>of(
                "messageId", m.messageId(),
                "receiptHandle", m.receiptHandle(),
                "body", body
            );
        }).collect(Collectors.toList());
        return Map.of("messages", messages, "count", messages.size());
    }

    public Map<String, Object> getEmailLog() {
        String logTable = props.getAws().getDynamodb().getTables().getEmailLog();
        ScanResponse resp = dynamo.scan(ScanRequest.builder().tableName(logTable).build());
        List<Map<String, Object>> items = resp.items().stream().map(item -> {
            Map<String, Object> m = new LinkedHashMap<>();
            item.forEach((k, v) -> m.put(k, v.s() != null ? v.s() : v.n()));
            return m;
        }).collect(Collectors.toList());
        items.sort(Comparator.comparing(
            i -> (String) i.getOrDefault("timestamp", ""), Comparator.reverseOrder()));
        return Map.of("items", items, "count", items.size());
    }
}
