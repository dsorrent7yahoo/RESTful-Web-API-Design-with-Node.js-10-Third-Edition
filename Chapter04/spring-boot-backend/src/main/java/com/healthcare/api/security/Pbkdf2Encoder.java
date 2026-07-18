package com.healthcare.api.security;

import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.util.HexFormat;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

import org.springframework.stereotype.Component;

/**
 * Encodes and verifies passwords using PBKDF2-HMAC-SHA256.
 * Format: pbkdf2_sha256$<iterations>$<salt_hex>$<digest_hex>
 */
@Component
public class Pbkdf2Encoder {

    public boolean matches(String rawPassword, String encoded) {
        if (encoded == null || !encoded.startsWith("pbkdf2_sha256$")) {
            return false;
        }
        String[] parts = encoded.split("\\$", 4);
        if (parts.length != 4) return false;
        int iterations = Integer.parseInt(parts[1]);
        String salt = parts[2];
        String storedHash = parts[3];
        try {
            byte[] raw = pbkdf2Raw(rawPassword, salt, iterations);
            String asHex = HexFormat.of().formatHex(raw);
            return storedHash.equals(asHex);
        } catch (Exception e) {
            return false;
        }
    }

    public String encode(String rawPassword) {
        byte[] saltBytes = generateSalt();
        String saltHex = HexFormat.of().formatHex(saltBytes);
        int iterations = 120000;
        String hash = HexFormat.of().formatHex(pbkdf2Raw(rawPassword, saltHex, iterations));
        return "pbkdf2_sha256$" + iterations + "$" + saltHex + "$" + hash;
    }

    private byte[] pbkdf2Raw(String password, String salt, int iterations) {
        try {
            // Salt is stored as a hex string (Flask: salt.hex()), must be decoded to bytes
            byte[] saltBytes = HexFormat.of().parseHex(salt);
            PBEKeySpec spec = new PBEKeySpec(
                password.toCharArray(),
                saltBytes,
                iterations,
                256
            );
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return skf.generateSecret(spec).getEncoded();
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new RuntimeException("Password encoding failed", e);
        }
    }

    private byte[] generateSalt() {
        byte[] salt = new byte[16];
        new java.security.SecureRandom().nextBytes(salt);
        return salt;
    }
}
