package com.healthcare.api.service;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;
import software.amazon.awssdk.services.glue.GlueClient;
import software.amazon.awssdk.services.glue.model.*;
// Explicit Glue aliases to avoid ambiguity with DynamoDB
import software.amazon.awssdk.services.glue.model.DeleteTableRequest;
import software.amazon.awssdk.services.glue.model.CreateTableRequest;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ExportService {

    private final S3Client s3;
    private final GlueClient glue;
    private final DynamoDbClient dynamo;
    private final AppProperties props;

    // ── S3 ──────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listBuckets() {
        return s3.listBuckets().buckets().stream()
                .map(b -> Map.<String, Object>of(
                        "name", b.name(),
                        "creationDate", b.creationDate().toString()))
                .collect(Collectors.toList());
    }

    public Map<String, Object> listObjects(String bucket, String prefix) {
        String p = prefix != null ? prefix : "";
        ListObjectsV2Response resp = s3.listObjectsV2(
                ListObjectsV2Request.builder().bucket(bucket).prefix(p).build());
        List<Map<String, Object>> objects = resp.contents().stream()
                .map(o -> Map.<String, Object>of(
                        "key", o.key(),
                        "size", o.size(),
                        "lastModified", o.lastModified().toString()))
                .collect(Collectors.toList());
        return Map.of("bucket", bucket, "prefix", p,
                "objects", objects, "count", objects.size());
    }

    /** Export a single DynamoDB table to S3 as CSV. */
    public Map<String, Object> exportTableToS3(String tableName, String bucket, String prefix) {
        String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
        String p = (prefix != null ? prefix : "exports/") + tableName + ".csv";

        // Scan table
        List<Map<String, AttributeValue>> items = new ArrayList<>();
        Map<String, AttributeValue> lastKey = null;
        do {
            ScanRequest.Builder req = ScanRequest.builder().tableName(tableName);
            if (lastKey != null) req.exclusiveStartKey(lastKey);
            ScanResponse resp = dynamo.scan(req.build());
            items.addAll(resp.items());
            lastKey = resp.lastEvaluatedKey().isEmpty() ? null : resp.lastEvaluatedKey();
        } while (lastKey != null);

        if (items.isEmpty()) {
            return Map.of("status", "ok", "table", tableName, "key", p, "rows", 0);
        }

        // Build CSV
        Set<String> colSet = new LinkedHashSet<>();
        items.forEach(item -> colSet.addAll(item.keySet()));
        List<String> cols = new ArrayList<>(colSet);

        StringBuilder csv = new StringBuilder(String.join(",", cols)).append("\n");
        for (Map<String, AttributeValue> item : items) {
            StringJoiner row = new StringJoiner(",");
            for (String col : cols) {
                AttributeValue v = item.get(col);
                String val = v == null ? "" : (v.s() != null ? v.s() : v.n() != null ? v.n() : "");
                row.add("\"" + val.replace("\"", "\"\"") + "\"");
            }
            csv.append(row).append("\n");
        }

        byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        s3.putObject(PutObjectRequest.builder().bucket(b).key(p).contentType("text/csv").build(),
                RequestBody.fromBytes(bytes));

        return Map.of("status", "ok", "table", tableName, "bucket", b,
                "key", p, "rows", items.size(), "bytes", bytes.length);
    }

    // ── Glue ─────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listGlueDatabases() {
        return glue.getDatabases(GetDatabasesRequest.builder().build())
                .databaseList().stream()
                .map(d -> Map.<String, Object>of("name", d.name(),
                        "description", d.description() != null ? d.description() : ""))
                .collect(Collectors.toList());
    }

    public List<Map<String, Object>> listGlueTables(String database) {
        String db = database != null ? database : props.getAws().getGlue().getDatabase();
        return glue.getTables(GetTablesRequest.builder().databaseName(db).build())
                .tableList().stream()
                .map(t -> Map.<String, Object>of(
                        "name", t.name(),
                        "database", db,
                        "location", t.storageDescriptor() != null
                                && t.storageDescriptor().location() != null
                                ? t.storageDescriptor().location() : ""))
                .collect(Collectors.toList());
    }

    /** Register an S3 CSV path as a Glue table. Infers schema from first row. */
    public Map<String, Object> registerGlueTable(String database, String tableName,
                                                   String s3Location, List<String> columns,
                                                   String bucket, String key) {
        String db = database != null ? database : props.getAws().getGlue().getDatabase();

        // Read header from S3 if columns not provided
        List<String> cols = columns;
        if (cols == null || cols.isEmpty()) {
            cols = inferColumnsFromS3(bucket, key);
        }

        List<Column> glueColumns = cols.stream()
                .map(c -> Column.builder().name(c.toLowerCase().replace(" ", "_")).type("string").build())
                .collect(Collectors.toList());

        String location = s3Location;
        if (location == null || location.isBlank()) {
            String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
            String k = key != null ? key : "";
            String folder = k.contains("/") ? k.substring(0, k.lastIndexOf('/') + 1) : "";
            location = "s3://" + b + "/" + folder;
        }

        try {
            glue.deleteTable(software.amazon.awssdk.services.glue.model.DeleteTableRequest.builder().databaseName(db).name(tableName).build());
        } catch (Exception ignored) {}

        glue.createTable(software.amazon.awssdk.services.glue.model.CreateTableRequest.builder()
                .databaseName(db)
                .tableInput(TableInput.builder()
                        .name(tableName)
                        .storageDescriptor(StorageDescriptor.builder()
                                .columns(glueColumns)
                                .location(location)
                                .inputFormat("org.apache.hadoop.mapred.TextInputFormat")
                                .outputFormat("org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat")
                                .serdeInfo(SerDeInfo.builder()
                                        .serializationLibrary("org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe")
                                        .parameters(Map.of("field.delim", ",",
                                                "skip.header.line.count", "1"))
                                        .build())
                                .build())
                        .tableType("EXTERNAL_TABLE")
                        .parameters(Map.of("classification", "csv",
                                "skip.header.line.count", "1"))
                        .build())
                .build());

        return Map.of("status", "ok", "database", db, "table", tableName,
                "location", location, "columns", cols.size());
    }

    private List<String> inferColumnsFromS3(String bucket, String key) {
        try {
            String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
            var stream = s3.getObject(GetObjectRequest.builder().bucket(b).key(key).build());
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream))) {
                String header = reader.readLine();
                if (header != null) return Arrays.asList(header.split(","));
            }
        } catch (Exception e) {
            log.warn("Could not infer columns from S3: {}", e.getMessage());
        }
        return List.of();
    }

    // ── Pipeline ─────────────────────────────────────────────────────────────

    /** Export ALL DynamoDB tables → S3 → register in Glue. Returns summary. */
    public List<Map<String, Object>> exportAllPipeline(String bucket, String prefix) {
        String b = bucket != null ? bucket : props.getAws().getS3().getStagingBucket();
        String p = prefix != null ? prefix : "exports/";
        String db = props.getAws().getGlue().getDatabase();

        List<String> tables = dynamo.listTables().tableNames();
        List<Map<String, Object>> results = new ArrayList<>();

        for (String table : tables) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("table", table);
            try {
                Map<String, Object> exportResult = exportTableToS3(table, b, p);
                result.put("s3_key", exportResult.get("key"));
                result.put("rows", exportResult.get("rows"));
                result.put("export", "ok");

                // Register in Glue
                String s3Location = "s3://" + b + "/" + p + table + "/";
                String key = p + table + ".csv";
                Map<String, Object> glueResult = registerGlueTable(db, table, s3Location, null, b, key);
                result.put("glue", "ok");
                result.put("glue_columns", glueResult.get("columns"));
            } catch (Exception e) {
                result.put("error", e.getMessage());
            }
            results.add(result);
        }
        return results;
    }
}
