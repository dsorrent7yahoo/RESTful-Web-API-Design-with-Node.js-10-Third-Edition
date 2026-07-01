package com.healthcare.api.controller;

import com.healthcare.api.config.AppProperties;
import com.healthcare.api.service.S3Service;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.InvokeRequest;
import software.amazon.awssdk.services.lambda.model.InvokeResponse;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/claims")
@RequiredArgsConstructor
public class ClaimsController {

    private final S3Service s3Service;
    private final AppProperties props;
    private final LambdaClient lambda;
    private final S3Client s3;

    @GetMapping("/files")
    public ResponseEntity<Object> listFiles(
            @RequestParam(required = false) String bucket,
            @RequestParam(required = false) String prefix) {
        String p = prefix != null ? prefix : props.getAws().getS3().getClaimsPrefix();
        List<Map<String, Object>> files = s3Service.listFiles(bucket, p);
        return ResponseEntity.ok(Map.of("files", files, "count", files.size()));
    }

    @GetMapping("/parquet-files")
    public ResponseEntity<Object> listParquetFiles(
            @RequestParam(required = false) String bucket,
            @RequestParam(required = false) String prefix) {
        String p = prefix != null ? prefix : props.getAws().getS3().getCleanPrefix();
        List<Map<String, Object>> files = s3Service.listFiles(bucket, p);
        return ResponseEntity.ok(Map.of("files", files, "count", files.size()));
    }

    @GetMapping("/file")
    public ResponseEntity<Object> getFile(
            @RequestParam(required = false) String bucket,
            @RequestParam String key) {
        if (key == null || key.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "key is required"));
        }
        List<Map<String, Object>> rows = s3Service.getCsvRows(bucket, key);
        return ResponseEntity.ok(Map.of("key", key, "rows", rows, "count", rows.size()));
    }

    @PostMapping("/generate")
    public ResponseEntity<Object> generate(@RequestBody(required = false) Map<String, Object> body) {
        String funcName = props.getLambda().getClaimsGeneratorFunction();
        String payload = body != null ? toJson(body) : "{}";
        return invokeLambda(funcName, payload);
    }

    @PostMapping("/clean")
    public ResponseEntity<Object> clean(@RequestBody(required = false) Map<String, Object> body) {
        // If no key provided, auto-find the most recent CSV in claims/ prefix
        String key = body != null ? (String) body.get("key") : null;
        if (key == null || key.isBlank()) {
            String bucket = props.getAws().getS3().getStagingBucket();
            String prefix = props.getAws().getS3().getClaimsPrefix();
            var resp = s3.listObjectsV2(ListObjectsV2Request.builder()
                    .bucket(bucket).prefix(prefix).build());
            key = resp.contents().stream()
                    .filter(o -> o.key().endsWith(".csv"))
                    .max(java.util.Comparator.comparing(o -> o.lastModified()))
                    .map(o -> o.key()).orElse(null);
        }
        if (key == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "No CSV file found in claims/"));
        }
        String funcName = props.getLambda().getClaimsCleanerFunction();
        String payload = "{\"key\":\"" + key + "\"}";
        return invokeLambda(funcName, payload);
    }

    @PostMapping("/process-all")
    public ResponseEntity<Object> processAll(@RequestBody(required = false) Map<String, Object> body) {
        // Clean + delete ALL CSVs in the claims/ prefix
        String bucket = props.getAws().getS3().getStagingBucket();
        String prefix = props.getAws().getS3().getClaimsPrefix();
        var resp = s3.listObjectsV2(ListObjectsV2Request.builder()
                .bucket(bucket).prefix(prefix).build());
        List<String> csvKeys = resp.contents().stream()
                .filter(o -> o.key().endsWith(".csv"))
                .map(o -> o.key())
                .collect(java.util.stream.Collectors.toList());

        List<Map<String, Object>> results = new java.util.ArrayList<>();
        String funcName = props.getLambda().getClaimsCleanerFunction();
        for (String key : csvKeys) {
            try {
                String payload = "{\"key\":\"" + key + "\"}";
                InvokeResponse r = lambda.invoke(InvokeRequest.builder()
                        .functionName(funcName)
                        .payload(SdkBytes.fromString(payload, StandardCharsets.UTF_8))
                        .build());
                results.add(Map.of("key", key, "status", "ok",
                        "statusCode", r.statusCode()));
                s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
            } catch (Exception e) {
                results.add(Map.of("key", key, "status", "error", "error", e.getMessage()));
            }
        }
        return ResponseEntity.ok(Map.of("status", "ok", "processed", results.size(), "results", results));
    }

    private ResponseEntity<Object> invokeLambda(String functionName, String payload) {
        try {
            InvokeResponse response = lambda.invoke(InvokeRequest.builder()
                    .functionName(functionName)
                    .payload(SdkBytes.fromString(payload, StandardCharsets.UTF_8))
                    .build());
            String result = response.payload().asUtf8String();
            return ResponseEntity.ok(Map.of("status", "ok", "function", functionName,
                    "statusCode", response.statusCode(), "result", result));
        } catch (Exception e) {
            return ResponseEntity.status(400).body(Map.of("error", e.getMessage(), "function", functionName));
        }
    }

    private String toJson(Map<String, Object> body) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body);
        } catch (Exception e) { return "{}"; }
    }
}

