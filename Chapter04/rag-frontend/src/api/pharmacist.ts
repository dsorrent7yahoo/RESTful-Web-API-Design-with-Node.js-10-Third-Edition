/**
 * pharmacist.ts — Pre-React API client for the Pharmacist Review API (:4006)
 *
 * Pure TypeScript service layer — no framework dependency.
 * These functions are invoked before the Preact component renders,
 * making the component responsible only for UI, not HTTP logic.
 */

const BASE = '/api/pharmacist';

// Demo JWT — 10-year token signed with the EC2 JWT_SECRET.
const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyYWctZGVtbyIsInJvbGUiOiJ1c2VyIiwiZXhwIjoyMDk4ODI4MzExfQ.0Vr--ftCfuspib9JftSppw5ue8DfTwJ17oK9-kKi6Xk';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: AUTH };

export interface DRPReviewRequest {
  drug_name: string;
  patient_conditions?: string[];
  top_k?: number;
}

export interface InteractionRequest {
  drugs: string[];
}

export interface DRPResponse {
  drug_name: string;
  answer: string;
  sources_count: number;
  latency_ms: number;
  tokens_total: number;
  error?: string;
}

/** Review a single medication for Drug-Related Problems using FDA label data. */
export async function reviewMedication(req: DRPReviewRequest): Promise<DRPResponse> {
  const resp = await fetch(`${BASE}/review/medication`, {
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

/** Check drug-drug interactions between two or more medications. */
export async function checkInteraction(req: InteractionRequest): Promise<DRPResponse> {
  const resp = await fetch(`${BASE}/review/interaction`, {
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
