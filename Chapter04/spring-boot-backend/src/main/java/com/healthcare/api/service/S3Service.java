package com.healthcare.api.service;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class S3Service {

    private final S3Client s3;
    private final AppProperties props;

    public List<Map<String, Object>> listFiles(String bucket, String prefix) {
        String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
        ListObjectsV2Response resp = s3.listObjectsV2(ListObjectsV2Request.builder()
            .bucket(b).prefix(prefix).build());
        return resp.contents().stream()
            .filter(o -> !o.key().endsWith("/"))
            .map(o -> Map.<String, Object>of(
                "key", o.key(),
                "size", o.size(),
                "lastModified", o.lastModified().toString()
            ))
            .collect(Collectors.toList());
    }

    public List<Map<String, Object>> getCsvRows(String bucket, String key) {
        String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
        ResponseInputStream<GetObjectResponse> stream = s3.getObject(
            GetObjectRequest.builder().bucket(b).key(key).build());
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            List<String> lines = reader.lines().collect(Collectors.toList());
            if (lines.isEmpty()) return List.of();
            String[] headers = lines.get(0).split(",");
            List<Map<String, Object>> rows = new ArrayList<>();
            for (int i = 1; i < lines.size(); i++) {
                String[] vals = lines.get(i).split(",", -1);
                Map<String, Object> row = new LinkedHashMap<>();
                for (int j = 0; j < headers.length; j++) {
                    row.put(headers[j].trim(), j < vals.length ? vals[j].trim() : "");
                }
                rows.add(row);
            }
            return rows;
        } catch (Exception e) {
            throw new RuntimeException("Failed to read S3 file: " + e.getMessage(), e);
        }
    }

    public void putObject(String bucket, String key, byte[] data, String contentType) {
        s3.putObject(PutObjectRequest.builder()
            .bucket(bucket).key(key).contentType(contentType).build(),
            RequestBody.fromBytes(data));
    }

    public void deleteObject(String bucket, String key) {
        s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    }
}
