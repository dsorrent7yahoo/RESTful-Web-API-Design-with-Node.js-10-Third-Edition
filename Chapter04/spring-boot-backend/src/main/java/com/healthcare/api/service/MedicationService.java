package com.healthcare.api.service;

import com.healthcare.api.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.math.BigDecimal;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class MedicationService {

    private final DynamoDbClient dynamo;
    private final AppProperties props;

    private String table() { return props.getAws().getDynamodb().getTables().getMedications(); }

    public Map<String, Object> list(Integer topN, Integer limit, String startKeyJson,
                                    String id, String patientId, String medicationId) {
        if (id != null) {
            Map<String, Object> item = getById(id);
            return Map.of("items", item != null ? List.of(item) : List.of(),
                "lastEvaluatedKey", (Object) null);
        }

        ScanRequest.Builder builder = ScanRequest.builder().tableName(table());

        // Add filter expressions if needed
        List<String> conditions = new ArrayList<>();
        Map<String, AttributeValue> exprVals = new HashMap<>();
        Map<String, String> exprNames = new HashMap<>();

        if (patientId != null) {
            conditions.add("#patient = :pid");
            exprNames.put("#patient", "patient");
            exprVals.put(":pid", AttributeValue.fromS(patientId));
        }
        if (medicationId != null) {
            conditions.add("#code = :mid");
            exprNames.put("#code", "code");
            exprVals.put(":mid", AttributeValue.fromS(medicationId));
        }

        if (!conditions.isEmpty()) {
            builder.filterExpression(String.join(" AND ", conditions))
                .expressionAttributeValues(exprVals);
            if (!exprNames.isEmpty()) builder.expressionAttributeNames(exprNames);
        }

        int effectiveLimit = (topN != null && topN > 0) ? topN : (limit != null ? limit : 50);
        builder.limit(effectiveLimit);

        if (startKeyJson != null && !startKeyJson.isBlank()) {
            try {
                Map<String, AttributeValue> lastKey = Map.of(
                    "id", AttributeValue.fromS(startKeyJson.replaceAll("[{}\"]", "")
                        .split(":")[1].trim()));
                builder.exclusiveStartKey(lastKey);
            } catch (Exception ignored) {}
        }

        ScanResponse resp = dynamo.scan(builder.build());
        List<Map<String, Object>> items = resp.items().stream().map(this::toMap).toList();
        Map<String, Object> lastKey = resp.hasLastEvaluatedKey()
            ? Map.of("id", resp.lastEvaluatedKey().get("id").s()) : null;
        return Map.of("items", items, "lastEvaluatedKey", lastKey != null ? lastKey : "");
    }

    public Map<String, Object> getById(String id) {
        GetItemResponse resp = dynamo.getItem(GetItemRequest.builder()
            .tableName(table())
            .key(Map.of("id", AttributeValue.fromS(id)))
            .build());
        return resp.hasItem() ? toMap(resp.item()) : null;
    }

    public Map<String, Object> getByPatient(String patient) {
        ScanResponse resp = dynamo.scan(ScanRequest.builder()
            .tableName(table())
            .filterExpression("#p = :v")
            .expressionAttributeNames(Map.of("#p", "patient"))
            .expressionAttributeValues(Map.of(":v", AttributeValue.fromS(patient)))
            .build());
        return Map.of("items", resp.items().stream().map(this::toMap).toList());
    }

    public Map<String, Object> getByCode(String code) {
        ScanResponse resp = dynamo.scan(ScanRequest.builder()
            .tableName(table())
            .filterExpression("#c = :v")
            .expressionAttributeNames(Map.of("#c", "code"))
            .expressionAttributeValues(Map.of(":v", AttributeValue.fromS(code)))
            .build());
        return Map.of("items", resp.items().stream().map(this::toMap).toList());
    }

    public Map<String, Object> create(Map<String, Object> body) {
        String id = body.containsKey("id") ? (String) body.get("id") : UUID.randomUUID().toString();
        Map<String, AttributeValue> item = toAttrMap(body);
        item.put("id", AttributeValue.fromS(id));
        dynamo.putItem(PutItemRequest.builder().tableName(table()).item(item).build());
        return getById(id);
    }

    public Map<String, Object> update(String id, Map<String, Object> body) {
        Map<String, Object> existing = getById(id);
        if (existing == null) throw new RuntimeException("NOT_FOUND");
        Map<String, AttributeValue> newItem = toAttrMap(body);
        newItem.put("id", AttributeValue.fromS(id));
        dynamo.putItem(PutItemRequest.builder().tableName(table()).item(newItem).build());
        return getById(id);
    }

    public void delete(String id) {
        Map<String, Object> existing = getById(id);
        if (existing == null) throw new RuntimeException("NOT_FOUND");
        dynamo.deleteItem(DeleteItemRequest.builder()
            .tableName(table())
            .key(Map.of("id", AttributeValue.fromS(id)))
            .build());
    }

    public Map<String, Object> patientsWithMultipleMedications(Integer topN) {
        ScanResponse resp = dynamo.scan(ScanRequest.builder().tableName(table()).build());
        Map<String, Map<String, Integer>> patientMeds = new HashMap<>();
        for (Map<String, AttributeValue> item : resp.items()) {
            String patient = item.containsKey("patient") ? item.get("patient").s() : "";
            String code = item.containsKey("code") ? item.get("code").s() : "";
            String desc = item.containsKey("description") ? item.get("description").s() : code;
            if (!patient.isBlank()) {
                patientMeds.computeIfAbsent(patient, k -> new HashMap<>())
                    .merge(code + "|" + desc, 1, Integer::sum);
            }
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, Map<String, Integer>> e : patientMeds.entrySet()) {
            if (e.getValue().size() >= 2) {
                List<Map<String, Object>> meds = e.getValue().entrySet().stream()
                    .map(m -> {
                        String[] parts = m.getKey().split("\\|", 2);
                        return Map.<String, Object>of(
                            "medicationId", parts[0],
                            "medicationName", parts.length > 1 ? parts[1] : parts[0],
                            "count", m.getValue()
                        );
                    })
                    .sorted(Comparator.comparingInt(m -> -(int) m.get("count")))
                    .toList();
                result.add(Map.of(
                    "patientId", e.getKey(),
                    "patientName", (Object) null,
                    "medicationCount", e.getValue().size(),
                    "medications", meds
                ));
            }
        }
        result.sort(Comparator.comparingInt(m -> -(int) m.get("medicationCount")));
        List<Map<String, Object>> limited = topN != null && topN > 0
            ? result.subList(0, Math.min(topN, result.size())) : result;
        return Map.of("totalPatients", limited.size(), "items", limited);
    }

    private Map<String, Object> toMap(Map<String, AttributeValue> item) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", str(item, "id"));
        m.put("start", str(item, "start"));
        m.put("stop", str(item, "stop"));
        m.put("patient", str(item, "patient"));
        m.put("payer", str(item, "payer"));
        m.put("encounter", str(item, "encounter"));
        m.put("code", str(item, "code"));
        m.put("description", str(item, "description"));
        m.put("baseCost", num(item, "baseCost"));
        m.put("payerCoverage", num(item, "payerCoverage"));
        m.put("dispenses", num(item, "dispenses"));
        m.put("totalCost", num(item, "totalCost"));
        m.put("reasonCode", str(item, "reasonCode"));
        m.put("reasonDescription", str(item, "reasonDescription"));
        return m;
    }

    private Map<String, AttributeValue> toAttrMap(Map<String, Object> body) {
        Map<String, AttributeValue> m = new HashMap<>();
        for (String key : List.of("start", "stop", "patient", "payer", "encounter",
            "code", "description", "reasonCode", "reasonDescription")) {
            Object val = body.get(key);
            if (val != null) m.put(key, AttributeValue.fromS(val.toString()));
        }
        for (String key : List.of("baseCost", "payerCoverage", "dispenses", "totalCost")) {
            Object val = body.get(key);
            if (val != null) m.put(key, AttributeValue.fromN(val.toString()));
        }
        return m;
    }

    private String str(Map<String, AttributeValue> item, String key) {
        return item.containsKey(key) ? item.get(key).s() : null;
    }

    private Object num(Map<String, AttributeValue> item, String key) {
        if (!item.containsKey(key)) return null;
        String n = item.get(key).n();
        if (n == null) return null;
        try { return new BigDecimal(n); } catch (Exception e) { return null; }
    }
}
