package com.healthcare.api.controller;

import com.healthcare.api.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<Object> login(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String password = body.get("password");
        if (email == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "email and password are required"));
        }
        try {
            return ResponseEntity.ok(authService.login(email, password));
        } catch (RuntimeException e) {
            if ("INVALID_CREDENTIALS".equals(e.getMessage())) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid email or password"));
            }
            throw e;
        }
    }

    @PostMapping("/register")
    public ResponseEntity<Object> register(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String password = body.get("password");
        String username = body.get("username");
        if (email == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "email and password are required"));
        }
        try {
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(
                authService.register(email, password, username));
        } catch (RuntimeException e) {
            if ("USER_EXISTS".equals(e.getMessage()) || "PENDING_EXISTS".equals(e.getMessage())) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "User already exists or has a pending registration"));
            }
            throw e;
        }
    }

    @GetMapping("/approve")
    public ResponseEntity<Object> approveGet(@RequestParam String token) {
        return doApprove(token);
    }

    @PostMapping("/approve")
    public ResponseEntity<Object> approvePost(@RequestBody Map<String, String> body) {
        return doApprove(body.get("token"));
    }

    private ResponseEntity<Object> doApprove(String token) {
        if (token == null || token.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Approval token is required"));
        }
        try {
            return ResponseEntity.ok(authService.approve(token));
        } catch (RuntimeException e) {
            return switch (e.getMessage()) {
                case "NOT_FOUND" -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Pending request not found"));
                case "EXPIRED" -> ResponseEntity.status(HttpStatus.GONE)
                    .body(Map.of("error", "Approval token has expired"));
                default -> throw e;
            };
        }
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Object> forgotPassword(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String newPassword = body.get("newPassword");
        if (email == null || newPassword == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "email and newPassword are required"));
        }
        try {
            return ResponseEntity.ok(authService.forgotPassword(email, newPassword));
        } catch (RuntimeException e) {
            if ("NOT_FOUND".equals(e.getMessage())) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "User not found"));
            }
            throw e;
        }
    }

    @GetMapping("/me")
    public ResponseEntity<Object> me(@AuthenticationPrincipal String email) {
        return ResponseEntity.ok(authService.me(email));
    }

    @PostMapping("/logout")
    public ResponseEntity<Object> logout(@AuthenticationPrincipal String email) {
        return ResponseEntity.ok(Map.of(
            "status", "ok",
            "message", "Logged out. Discard token on client side."
        ));
    }
}
