package com.healthcare.api.controller;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.ListTablesResponse;

import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
public class CoreController {

    private final DynamoDbClient dynamo;

    @GetMapping("/health")
    public ResponseEntity<Object> health() {
        return ResponseEntity.ok(Map.of("status", "ok", "service", "spring-boot-healthcare-api"));
    }

    @GetMapping("/")
    public ResponseEntity<Object> index() {
        return ResponseEntity.ok(Map.of(
            "message", "Spring Boot Healthcare API is running.",
            "docs", "/api-docs",
            "health", "/health"
        ));
    }

    @GetMapping("/tables")
    public ResponseEntity<Object> tables(@AuthenticationPrincipal String email) {
        ListTablesResponse resp = dynamo.listTables();
        List<String> tables = resp.tableNames();
        return ResponseEntity.ok(Map.of(
            "tables", tables,
            "user", Map.of("email", email)
        ));
    }
}
