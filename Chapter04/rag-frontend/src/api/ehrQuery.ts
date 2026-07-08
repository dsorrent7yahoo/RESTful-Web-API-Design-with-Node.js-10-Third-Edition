/**
 * ehrQuery.ts — Pre-React API client for the EHR Natural Language Query API (:4007)
 *
 * Pure TypeScript service layer — converts plain English to DynamoDB PartiQL.
 * Invoked before the Preact component renders; component handles only display.
 */

const BASE = '/api/ehr';

const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyYWctZGVtbyIsInJvbGUiOiJ1c2VyIiwiZXhwIjoyMDk4ODI4MzExfQ.0Vr--ftCfuspib9JftSppw5ue8DfTwJ17oK9-kKi6Xk';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: AUTH };
const AUTH_HEADER = { Authorization: AUTH };

export interface NLQueryRequest {
  question: string;
  top_k?: number;
}

export interface QueryResponse {
  question: string;
  partiql: string;
  explanation: string;
  tables_referenced: string[];
  latency_ms: number;
  tokens_total: number;
}

export interface TableListResponse {
  tables: string[];
  rag_internal: string[];
}

/** Translate a natural-language EHR question to a DynamoDB PartiQL SELECT. */
export async function nlToPartiQL(req: NLQueryRequest): Promise<QueryResponse> {
  const resp = await fetch(`${BASE}/ehr/query`, {
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

/** List all queryable DynamoDB table names. */
export async function listTables(): Promise<TableListResponse> {
  const resp = await fetch(`${BASE}/ehr/tables`, { headers: AUTH_HEADER });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface ExecuteRequest {
  partiql: string;
  limit?: number;
}

export interface ExecuteResponse {
  partiql: string;
  rows: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  latency_ms: number;
}

/** Execute a PartiQL SELECT statement against DynamoDB and return rows. */
export async function executePartiQL(req: ExecuteRequest): Promise<ExecuteResponse> {
  const resp = await fetch(`${BASE}/ehr/query/execute`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error((detail as { detail?: string })?.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}
