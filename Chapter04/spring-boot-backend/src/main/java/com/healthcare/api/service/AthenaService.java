package com.healthcare.api.service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.healthcare.api.config.AppProperties;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.athena.AthenaClient;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;
import software.amazon.awssdk.services.athena.model.Datum;
import software.amazon.awssdk.services.athena.model.GetQueryExecutionRequest;
import software.amazon.awssdk.services.athena.model.GetQueryExecutionResponse;
import software.amazon.awssdk.services.athena.model.GetQueryResultsRequest;
import software.amazon.awssdk.services.athena.model.GetQueryResultsResponse;
import software.amazon.awssdk.services.athena.model.QueryExecutionContext;
import software.amazon.awssdk.services.athena.model.QueryExecutionState;
import software.amazon.awssdk.services.athena.model.QueryExecutionStatistics;
import software.amazon.awssdk.services.athena.model.ResultConfiguration;
import software.amazon.awssdk.services.athena.model.Row;
import software.amazon.awssdk.services.athena.model.StartQueryExecutionRequest;
import software.amazon.awssdk.services.athena.model.StartQueryExecutionResponse;
import software.amazon.awssdk.services.glue.GlueClient;
import software.amazon.awssdk.services.glue.model.GetDatabasesRequest;
import software.amazon.awssdk.services.glue.model.GetDatabasesResponse;
import software.amazon.awssdk.services.glue.model.GetTablesRequest;
import software.amazon.awssdk.services.glue.model.GetTablesResponse;

@Slf4j
@Service
@RequiredArgsConstructor
public class AthenaService {

    private final AthenaClient athena;
    private final GlueClient glue;
    private final AppProperties props;
    private final BedrockRuntimeClient bedrock;

    public Map<String, Object> query(String sql, String database) {
        String db = database != null ? database : props.getAws().getAthena().getDatabase();
        String outputLocation = "s3://" + props.getAws().getS3().getStagingBucket()
            + "/" + props.getAws().getS3().getAthenaOutputPrefix();
        long start = System.currentTimeMillis();

        StartQueryExecutionResponse startResp = athena.startQueryExecution(
            StartQueryExecutionRequest.builder()
                .queryString(sql)
                .queryExecutionContext(QueryExecutionContext.builder().database(db).build())
                .resultConfiguration(ResultConfiguration.builder()
                    .outputLocation(outputLocation).build())
                .workGroup(props.getAws().getAthena().getWorkgroup())
                .build());

        String queryId = startResp.queryExecutionId();
        waitForQuery(queryId);

        GetQueryResultsResponse results = athena.getQueryResults(
            GetQueryResultsRequest.builder().queryExecutionId(queryId).build());

        List<String> columns = results.resultSet().resultSetMetadata().columnInfo()
            .stream().map(c -> c.name()).collect(Collectors.toList());

        List<Row> rows = results.resultSet().rows();
        List<Map<String, Object>> dataRows = new ArrayList<>();
        for (int i = 1; i < rows.size(); i++) {
            List<Datum> data = rows.get(i).data();
            Map<String, Object> row = new LinkedHashMap<>();
            for (int j = 0; j < columns.size(); j++) {
                row.put(columns.get(j), j < data.size() ? data.get(j).varCharValue() : null);
            }
            dataRows.add(row);
        }

        GetQueryExecutionResponse execResp = athena.getQueryExecution(
            GetQueryExecutionRequest.builder().queryExecutionId(queryId).build());
        QueryExecutionStatistics stats = execResp.queryExecution().statistics();
        long elapsed = System.currentTimeMillis() - start;

        return Map.of(
            "status", "ok",
            "database", db,
            "query_execution_id", queryId,
            "columns", columns,
            "rows", dataRows,
            "count", dataRows.size(),
            "elapsed_ms", elapsed,
            "scanned_bytes", stats != null ? stats.dataScannedInBytes() : 0,
            "output_location", outputLocation
        );
    }

    public Map<String, Object> getDatabases() {
        GetDatabasesResponse resp = glue.getDatabases(GetDatabasesRequest.builder().build());
        List<String> dbs = resp.databaseList().stream()
            .map(d -> d.name()).collect(Collectors.toList());
        return Map.of("databases", dbs);
    }

    public Map<String, Object> getTables(String database) {
        String db = database != null ? database : props.getAws().getGlue().getDatabase();
        GetTablesResponse resp = glue.getTables(GetTablesRequest.builder().databaseName(db).build());
        List<String> tables = resp.tableList().stream()
            .map(t -> t.name()).collect(Collectors.toList());
        return Map.of("database", db, "tables", tables);
    }

    public Map<String, Object> getSchema(String database) {
        String db = database != null ? database : props.getAws().getGlue().getDatabase();
        GetTablesResponse resp = glue.getTables(GetTablesRequest.builder().databaseName(db).build());
        Map<String, Object> schema = new LinkedHashMap<>();
        for (software.amazon.awssdk.services.glue.model.Table table : resp.tableList()) {
            List<Map<String, String>> cols = new ArrayList<>();
            if (table.storageDescriptor() != null) {
                for (software.amazon.awssdk.services.glue.model.Column col : table.storageDescriptor().columns()) {
                    cols.add(Map.of("name", col.name(), "type", col.type() != null ? col.type() : ""));
                }
            }
            schema.put(table.name(), cols);
        }
        return Map.of("database", db, "schema", schema);
    }

    private void waitForQuery(String queryId) {
        int maxRetries = props.getAws().getAthena().getMaxPollSeconds() * 2;
        for (int i = 0; i < maxRetries; i++) {
            GetQueryExecutionResponse resp = athena.getQueryExecution(
                GetQueryExecutionRequest.builder().queryExecutionId(queryId).build());
            QueryExecutionState state = resp.queryExecution().status().state();
            if (state == QueryExecutionState.SUCCEEDED) return;
            if (state == QueryExecutionState.FAILED || state == QueryExecutionState.CANCELLED) {
                String reason = resp.queryExecution().status().stateChangeReason();
                throw new RuntimeException("Athena query " + state + ": " + reason);
            }
            try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        throw new RuntimeException("Athena query timed out");
    }

    public Map<String, Object> generateSql(String prompt, String database) {
        String db = database != null ? database : props.getAws().getGlue().getDatabase();
        // Build schema context from Glue
        StringBuilder schemaCtx = new StringBuilder();
        try {
            for (software.amazon.awssdk.services.glue.model.Table t :
                    glue.getTables(software.amazon.awssdk.services.glue.model.GetTablesRequest
                            .builder().databaseName(db).build()).tableList()) {
                String cols = t.storageDescriptor() == null ? "" :
                        t.storageDescriptor().columns().stream()
                                .map(c -> c.name() + " " + c.type())
                                .collect(Collectors.joining(", "));
                schemaCtx.append("  ").append(t.name()).append("(").append(cols).append(")\n");
            }
        } catch (Exception e) {
            log.warn("Could not fetch schema for Bedrock prompt: {}", e.getMessage());
        }

        String sysMsg = "You are an expert Amazon Athena SQL generator (Presto SQL dialect).\n" +
                "Database: " + db + "\nAvailable tables:\n" + schemaCtx +
                "Rules:\n- Return ONLY the SQL, no explanation, no markdown.\n" +
                "- Use Athena/Presto syntax.\n- Always LIMIT unless pure aggregation.\n";

        try {
            ObjectMapper mapper = new ObjectMapper();
            Map<String, Object> payload = Map.of(
                "system", List.of(Map.of("text", sysMsg)),
                "messages", List.of(Map.of("role", "user",
                        "content", List.of(Map.of("text", prompt)))),
                "inferenceConfig", Map.of("maxTokens", 1024, "temperature", 0.1)
            );
            String jsonBody = mapper.writeValueAsString(payload);
            String modelId = props.getBedrock().getSqlModelId();

            var response = bedrock.invokeModel(InvokeModelRequest.builder()
                    .modelId(modelId)
                    .body(SdkBytes.fromUtf8String(jsonBody))
                    .contentType("application/json")
                    .accept("application/json")
                    .build());

            @SuppressWarnings("unchecked")
            Map<String, Object> result = mapper.readValue(
                    response.body().asUtf8String(), Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> output = (Map<String, Object>) result.get("output");
            @SuppressWarnings("unchecked")
            Map<String, Object> message = (Map<String, Object>) output.get("message");
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> content = (List<Map<String, Object>>) message.get("content");
            String sql = (String) content.get(0).get("text");
            // Strip markdown fences
            sql = Arrays.stream(sql.split("\n"))
                    .filter(l -> !l.trim().startsWith("```"))
                    .collect(Collectors.joining("\n")).strip();

            return Map.of("status", "ok", "sql", sql, "model", modelId, "database", db);
        } catch (Exception e) {
            throw new RuntimeException("Bedrock SQL generation failed: " + e.getMessage(), e);
        }
    }
}
