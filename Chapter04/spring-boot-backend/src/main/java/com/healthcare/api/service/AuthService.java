package com.healthcare.api.service;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.healthcare.api.config.AppProperties;
import com.healthcare.api.security.JwtService;
import com.healthcare.api.security.Pbkdf2Encoder;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.DeleteItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanResponse;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final DynamoDbClient dynamo;
    private final AppProperties props;
    private final Pbkdf2Encoder passwordEncoder;
    private final JwtService jwtService;

    private String usersTable() { return props.getAws().getDynamodb().getTables().getUsers(); }
    private String pendingTable() { return props.getAws().getDynamodb().getTables().getPendingUsers(); }

    public Map<String, Object> login(String email, String password) {
        Map<String, AttributeValue> key = Map.of("email", AttributeValue.fromS(email));
        GetItemResponse resp = dynamo.getItem(GetItemRequest.builder()
            .tableName(usersTable())
            .key(key)
            .build());
        if (!resp.hasItem()) {
            throw new RuntimeException("INVALID_CREDENTIALS");
        }
        Map<String, AttributeValue> item = resp.item();
        String storedHash = item.containsKey("passwordHash")
            ? item.get("passwordHash").s()
            : item.getOrDefault("password", AttributeValue.fromS("")).s();
        if (!passwordEncoder.matches(password, storedHash)) {
            throw new RuntimeException("INVALID_CREDENTIALS");
        }
        String username = item.containsKey("username") ? item.get("username").s() : email;
        String token = jwtService.generateToken(email, username);
        return Map.of(
            "status", "ok",
            "user", Map.of(
                "email", email,
                "username", username,
                "createdAt", item.containsKey("createdAt") ? item.get("createdAt").s() : ""
            ),
            "accessToken", token,
            "tokenType", "Bearer",
            "expiresAt", Instant.now().plusSeconds(props.getJwt().getExpirationMinutes() * 60L).toString()
        );
    }

    public Map<String, Object> register(String email, String password, String username) {
        // Check if user already exists
        GetItemResponse existing = dynamo.getItem(GetItemRequest.builder()
            .tableName(usersTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .build());
        if (existing.hasItem()) {
            throw new RuntimeException("USER_EXISTS");
        }
        // Check pending
        GetItemResponse pending = dynamo.getItem(GetItemRequest.builder()
            .tableName(pendingTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .build());
        if (pending.hasItem()) {
            throw new RuntimeException("PENDING_EXISTS");
        }

        String resolvedUsername = (username != null && !username.isBlank()) ? username
            : email.split("@")[0];
        String approvalToken = UUID.randomUUID().toString();
        String now = Instant.now().toString();
        String expiresAt = Instant.now().plusSeconds(86400).toString();

        Map<String, AttributeValue> item = new HashMap<>();
        item.put("email", AttributeValue.fromS(email));
        item.put("username", AttributeValue.fromS(resolvedUsername));
        item.put("passwordHash", AttributeValue.fromS(passwordEncoder.encode(password)));
        item.put("approvalToken", AttributeValue.fromS(approvalToken));
        item.put("requestedAt", AttributeValue.fromS(now));
        item.put("approvalExpiresAt", AttributeValue.fromS(expiresAt));

        dynamo.putItem(PutItemRequest.builder().tableName(pendingTable()).item(item).build());

        String devLink = "http://localhost:4003/auth/approve?token=" + approvalToken;
        return Map.of(
            "status", "pending_approval",
            "message", "Registration submitted and waiting for approval",
            "pendingUser", Map.of(
                "email", email,
                "username", resolvedUsername,
                "requestedAt", now,
                "approvalExpiresAt", expiresAt
            ),
            "approvalEmail", props.getApproval().getEmail(),
            "approvalEmailSent", false,
            "devApprovalLink", devLink
        );
    }

    public Map<String, Object> approve(String token) {
        // Scan pending-users for matching approval token
        ScanResponse scan = dynamo.scan(ScanRequest.builder()
            .tableName(pendingTable())
            .filterExpression("approvalToken = :t")
            .expressionAttributeValues(Map.of(":t", AttributeValue.fromS(token)))
            .build());
        if (scan.items().isEmpty()) {
            throw new RuntimeException("NOT_FOUND");
        }
        Map<String, AttributeValue> pending = scan.items().get(0);
        String email = pending.get("email").s();
        String expiresAt = pending.containsKey("approvalExpiresAt")
            ? pending.get("approvalExpiresAt").s() : "";
        if (!expiresAt.isEmpty() && Instant.now().isAfter(Instant.parse(expiresAt))) {
            throw new RuntimeException("EXPIRED");
        }

        // Move to users table
        Map<String, AttributeValue> userItem = new HashMap<>(pending);
        userItem.remove("approvalToken");
        userItem.remove("requestedAt");
        userItem.remove("approvalExpiresAt");
        userItem.put("createdAt", AttributeValue.fromS(Instant.now().toString()));

        dynamo.putItem(PutItemRequest.builder().tableName(usersTable()).item(userItem).build());
        dynamo.deleteItem(DeleteItemRequest.builder()
            .tableName(pendingTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .build());

        return Map.of(
            "status", "approved",
            "message", "User approved",
            "user", Map.of(
                "email", email,
                "username", pending.getOrDefault("username", AttributeValue.fromS("")).s(),
                "createdAt", Instant.now().toString()
            )
        );
    }

    public Map<String, Object> forgotPassword(String email, String newPassword) {
        GetItemResponse resp = dynamo.getItem(GetItemRequest.builder()
            .tableName(usersTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .build());
        if (!resp.hasItem()) {
            throw new RuntimeException("NOT_FOUND");
        }
        dynamo.updateItem(UpdateItemRequest.builder()
            .tableName(usersTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .updateExpression("SET #pw = :pw")
            .expressionAttributeNames(Map.of("#pw", "password"))
            .expressionAttributeValues(Map.of(":pw",
                AttributeValue.fromS(passwordEncoder.encode(newPassword))))
            .build());
        Map<String, AttributeValue> user = resp.item();
        return Map.of(
            "status", "ok",
            "message", "Password updated",
            "user", Map.of(
                "email", email,
                "username", user.getOrDefault("username", AttributeValue.fromS("")).s(),
                "createdAt", user.getOrDefault("createdAt", AttributeValue.fromS("")).s()
            )
        );
    }

    public Map<String, Object> me(String email) {
        GetItemResponse resp = dynamo.getItem(GetItemRequest.builder()
            .tableName(usersTable())
            .key(Map.of("email", AttributeValue.fromS(email)))
            .build());
        if (!resp.hasItem()) {
            throw new RuntimeException("NOT_FOUND");
        }
        Map<String, AttributeValue> user = resp.item();
        return Map.of(
            "status", "ok",
            "user", Map.of(
                "sub", email,
                "email", email,
                "username", user.getOrDefault("username", AttributeValue.fromS("")).s(),
                "createdAt", user.getOrDefault("createdAt", AttributeValue.fromS("")).s()
            )
        );
    }
}
