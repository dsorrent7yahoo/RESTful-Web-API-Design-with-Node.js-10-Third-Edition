package com.healthcare.api.controller;

import com.healthcare.api.service.AthenaService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.List;

@RestController
@RequestMapping("/athena")
@RequiredArgsConstructor
public class AthenaController {

    private final AthenaService athenaService;

    @PostMapping("/query")
    public ResponseEntity<Object> query(@RequestBody Map<String, String> body) {
        String sql = body.get("sql");
        String database = body.get("database");
        if (sql == null || sql.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sql is required"));
        }
        try {
            return ResponseEntity.ok(athenaService.query(sql, database));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/databases")
    public ResponseEntity<Object> databases() {
        try {
            return ResponseEntity.ok(athenaService.getDatabases());
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/tables")
    public ResponseEntity<Object> tables(@RequestParam(required = false) String database) {
        try {
            return ResponseEntity.ok(athenaService.getTables(database));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/schema")
    public ResponseEntity<Object> schema(@RequestParam(required = false) String database) {
        try {
            return ResponseEntity.ok(athenaService.getSchema(database));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/generate-sql")
    public ResponseEntity<Object> generateSql(@RequestBody Map<String, String> body) {
        String prompt   = body.get("prompt");
        String database = body.get("database");
        if (prompt == null || prompt.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "prompt is required"));
        }
        try {
            return ResponseEntity.ok(athenaService.generateSql(prompt, database));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
