package com.healthcare.api.service;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.athena.AthenaClient;
import software.amazon.awssdk.services.athena.model.*;
import software.amazon.awssdk.services.glue.GlueClient;
import software.amazon.awssdk.services.glue.model.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AthenaService {

    private final AthenaClient athena;
    private final GlueClient glue;
    private final AppProperties props;

    public Map<String, Object> query(String sql, String database) {
        String db = database != null ? database : props.getAws().getAthena().getDatabase();
        sql = normaliseSql(sql);
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
                for (Column col : table.storageDescriptor().columns()) {
                    cols.add(Map.of("name", col.name(), "type", col.type() != null ? col.type() : ""));
                }
            }
            schema.put(table.name(), cols);
        }
        return Map.of("database", db, "schema", schema);
    }

    /** Replace LLM-hallucinated column names with their real Athena/Glue equivalents. */
    private static String normaliseSql(String sql) {
        if (sql == null) return null;
        // medications table
        sql = sql.replaceAll("(?i)\\bmedication_name\\b", "description");
        sql = sql.replaceAll("(?i)\\bdrug_name\\b",       "description");
        sql = sql.replaceAll("(?i)\\bmed_name\\b",        "description");
        // qualified patient_id references first, then bare
        sql = sql.replaceAll("(?i)\\bmedications\\.patient_id\\b", "medications.patient");
        sql = sql.replaceAll("(?i)\\bclaims\\.patient_id\\b",      "claims.patient");
        return sql;
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
}
