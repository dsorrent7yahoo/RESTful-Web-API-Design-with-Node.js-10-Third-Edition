package com.healthcare.api.controller;

import com.healthcare.api.config.AppProperties;
import com.healthcare.api.service.S3Service;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/claims")
@RequiredArgsConstructor
public class ClaimsController {

    private final S3Service s3Service;
    private final AppProperties props;

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
}
