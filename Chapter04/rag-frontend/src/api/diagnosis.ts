/**
 * diagnosis.ts — Pre-React API client for the Diagnosis Support API (:4008)
 *
 * Pure TypeScript service layer — GARMLE-G evidence-based diagnosis.
 * Invoked before the Preact component renders; component handles only display.
 */

const BASE = '/api/diagnosis';

const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyYWctZGVtbyIsInJvbGUiOiJ1c2VyIiwiZXhwIjoyMDk4ODI4MzExfQ.0Vr--ftCfuspib9JftSppw5ue8DfTwJ17oK9-kKi6Xk';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: AUTH };

export interface PatientContext {
  lab_values?: Record<string, string>;
  current_medications?: string[];
  symptoms?: string[];
  age?: number;
  sex?: string;
  top_k?: number;
}

export interface LabRequest {
  loinc_code?: string;
  lab_name: string;
  value: string;
  patient_conditions?: string[];
}

export interface DiagnosisResponse {
  primary_diagnosis: string;
  icd_code: string | null;
  differential: string[];
  guideline_support: string;
  recommended_workup: string;
  full_report: string;
  sources_count: number;
  latency_ms: number;
}

export interface LabResponse {
  lab_name: string;
  value: string;
  loinc_code: string | null;
  interpretation: string;
  sources_count: number;
  latency_ms: number;
}

/** Generate a GARMLE-G differential diagnosis from patient lab/medication context. */
export async function evaluatePatient(ctx: PatientContext): Promise<DiagnosisResponse> {
  const resp = await fetch(`${BASE}/diagnosis/evaluate`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(ctx),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

/** Interpret a single lab value in clinical context using LOINC reference ranges. */
export async function interpretLab(req: LabRequest): Promise<LabResponse> {
  const resp = await fetch(`${BASE}/diagnosis/lab`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}
