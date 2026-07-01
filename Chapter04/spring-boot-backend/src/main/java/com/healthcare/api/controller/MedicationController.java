package com.healthcare.api.controller;

import com.healthcare.api.service.MedicationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/medications")
@RequiredArgsConstructor
public class MedicationController {

    private final MedicationService service;

    @GetMapping({"", "/"})
    public ResponseEntity<Object> list(
            @RequestParam(required = false) Integer topN,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String startKey,
            @RequestParam(required = false) String id,
            @RequestParam(required = false) String patientId,
            @RequestParam(required = false) String medicationId) {
        return ResponseEntity.ok(service.list(topN, limit, startKey, id, patientId, medicationId));
    }

    @PostMapping({"", "/"})
    public ResponseEntity<Object> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(body));
    }

    @GetMapping("/id/{id}")
    public ResponseEntity<Object> getById(@PathVariable String id) {
        Map<String, Object> item = service.getById(id);
        if (item == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(item);
    }

    @GetMapping("/patient/{patient}")
    public ResponseEntity<Object> getByPatient(@PathVariable String patient) {
        return ResponseEntity.ok(service.getByPatient(patient));
    }

    @GetMapping("/code/{code}")
    public ResponseEntity<Object> getByCode(@PathVariable String code) {
        return ResponseEntity.ok(service.getByCode(code));
    }

    @GetMapping("/medication/{medicationId}")
    public ResponseEntity<Object> getByMedicationId(@PathVariable String medicationId) {
        return ResponseEntity.ok(service.getByCode(medicationId));
    }

    @GetMapping("/patients/multiple-medications")
    public ResponseEntity<Object> patientsWithMultipleMedications(
            @RequestParam(required = false) Integer topN) {
        return ResponseEntity.ok(service.patientsWithMultipleMedications(topN));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Object> update(@PathVariable String id,
                                          @RequestBody Map<String, Object> body) {
        try {
            return ResponseEntity.ok(service.update(id, body));
        } catch (RuntimeException e) {
            if ("NOT_FOUND".equals(e.getMessage())) return ResponseEntity.notFound().build();
            throw e;
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Object> delete(@PathVariable String id) {
        try {
            service.delete(id);
            return ResponseEntity.ok(Map.of("Status", "Successfully deleted"));
        } catch (RuntimeException e) {
            if ("NOT_FOUND".equals(e.getMessage())) return ResponseEntity.notFound().build();
            throw e;
        }
    }

    @PostMapping("/upload")
    public ResponseEntity<Object> upload(
            @RequestParam(required = false) MultipartFile file,
            @RequestParam(required = false) String table,
            @RequestBody(required = false) Map<String, Object> body) {
        try {
            return ResponseEntity.ok(service.uploadCsv(file, table, body));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
