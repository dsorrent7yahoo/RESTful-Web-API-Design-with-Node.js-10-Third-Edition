package com.healthcare.api.controller;

import com.healthcare.api.service.ExportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/export")
@RequiredArgsConstructor
public class ExportController {

    private final ExportService exportService;

    // ── S3 ───────────────────────────────────────────────────────────────────

    @GetMapping("/s3/buckets")
    public ResponseEntity<Object> listBuckets() {
        List<Map<String, Object>> buckets = exportService.listBuckets();
        return ResponseEntity.ok(Map.of("buckets", buckets, "count", buckets.size()));
    }

    @GetMapping("/s3/{bucket}/objects")
    public ResponseEntity<Object> listObjects(
            @PathVariable String bucket,
            @RequestParam(required = false) String prefix) {
        return ResponseEntity.ok(exportService.listObjects(bucket, prefix));
    }

    @PostMapping("/s3")
    public ResponseEntity<Object> exportToS3(@RequestBody Map<String, Object> body) {
        String table  = (String) body.get("table");
        String bucket = (String) body.get("bucket");
        String prefix = (String) body.get("prefix");
        if (table == null || table.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "table is required"));
        }
        return ResponseEntity.ok(exportService.exportTableToS3(table, bucket, prefix));
    }

    // ── Glue ─────────────────────────────────────────────────────────────────

    @GetMapping("/glue/databases")
    public ResponseEntity<Object> listGlueDatabases() {
        List<Map<String, Object>> dbs = exportService.listGlueDatabases();
        return ResponseEntity.ok(Map.of("databases", dbs, "count", dbs.size()));
    }

    @GetMapping("/glue/databases/{database}/tables")
    public ResponseEntity<Object> listGlueTables(@PathVariable String database) {
        List<Map<String, Object>> tables = exportService.listGlueTables(database);
        return ResponseEntity.ok(Map.of("database", database, "tables", tables, "count", tables.size()));
    }

    @PostMapping("/glue")
    public ResponseEntity<Object> registerGlueTable(@RequestBody Map<String, Object> body) {
        String database   = (String) body.get("database");
        String tableName  = (String) body.get("table_name");
        String s3Location = (String) body.get("s3_location");
        String bucket     = (String) body.get("bucket");
        String key        = (String) body.get("key");
        @SuppressWarnings("unchecked")
        List<String> columns = (List<String>) body.get("columns");
        if (tableName == null || tableName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "table_name is required"));
        }
        return ResponseEntity.ok(
                exportService.registerGlueTable(database, tableName, s3Location, columns, bucket, key));
    }

    // ── Pipeline ─────────────────────────────────────────────────────────────

    @PostMapping("/pipeline/all")
    public ResponseEntity<Object> pipelineAll(@RequestBody(required = false) Map<String, Object> body) {
        String bucket = body != null ? (String) body.get("bucket") : null;
        String prefix = body != null ? (String) body.get("prefix") : null;
        List<Map<String, Object>> results = exportService.exportAllPipeline(bucket, prefix);
        long ok = results.stream().filter(r -> !r.containsKey("error")).count();
        return ResponseEntity.ok(Map.of("status", "ok", "processed", results.size(),
                "succeeded", ok, "failed", results.size() - ok, "results", results));
    }
}
