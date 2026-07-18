package com.healthcare.api.controller;

import com.healthcare.api.service.SqsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/sqs")
@RequiredArgsConstructor
public class SqsController {

    private final SqsService sqsService;

    @GetMapping("/messages")
    public ResponseEntity<Object> getMessages(@RequestParam(defaultValue = "10") int max) {
        try {
            return ResponseEntity.ok(sqsService.getMessages(max));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/messages")
    public ResponseEntity<Object> purge() {
        return ResponseEntity.ok(sqsService.purge());
    }

    @PostMapping("/ack")
    public ResponseEntity<Object> ack(@RequestBody Map<String, String> body) {
        String receiptHandle = body.get("receiptHandle");
        if (receiptHandle == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "receiptHandle is required"));
        }
        return ResponseEntity.ok(sqsService.deleteMessage(receiptHandle));
    }

    @GetMapping("/stats")
    public ResponseEntity<Object> stats() {
        try {
            return ResponseEntity.ok(sqsService.getStats());
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/dlq")
    public ResponseEntity<Object> dlqMessages(@RequestParam(defaultValue = "10") int max) {
        try {
            return ResponseEntity.ok(sqsService.getDlqMessages(max));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/dlq/stats")
    public ResponseEntity<Object> dlqStats() {
        try {
            return ResponseEntity.ok(sqsService.getDlqStats());
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/email-log")
    public ResponseEntity<Object> emailLog() {
        try {
            return ResponseEntity.ok(sqsService.getEmailLog());
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
