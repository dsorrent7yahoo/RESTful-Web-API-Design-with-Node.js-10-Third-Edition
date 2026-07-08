/**
 * athena.ts — API client for the Flask Athena SQL endpoints via /api/athena proxy.
 */

const BASE = '/api/athena';
const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyYWctZGVtbyIsInJvbGUiOiJ1c2VyIiwiZXhwIjoyMDk4ODI4MzExfQ.0Vr--ftCfuspib9JftSppw5ue8DfTwJ17oK9-kKi6Xk';
const H = { 'Content-Type': 'application/json', Authorization: AUTH };

export interface AthenaColumn { name: string; type: string; }
export interface AthenaResult {
  query_execution_id: string;
  columns: string[];
  rows: Record<string, string>[];
  count: number;
  elapsed_ms: number;
  scanned_bytes: number;
}

export async function runQuery(sql: string, database: string): Promise<AthenaResult> {
  const r = await fetch(`${BASE}/query`, { method: 'POST', headers: H, body: JSON.stringify({ sql, database }) });
  const d = await r.json();
  if (!r.ok || d.status === 'error') throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
}

export async function getDatabases(): Promise<string[]> {
  const r = await fetch(`${BASE}/databases`, { headers: H });
  const d = await r.json();
  return d.databases ?? [];
}

export async function getSchema(database: string): Promise<Record<string, AthenaColumn[]>> {
  const r = await fetch(`${BASE}/schema?database=${encodeURIComponent(database)}`, { headers: H });
  const d = await r.json();
  return d.schema ?? {};
}

export async function generateSQL(prompt: string, database: string): Promise<string> {
  const r = await fetch(`${BASE}/generate-sql`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ prompt, database }),
  });
  const d = await r.json();
  if (!r.ok || d.status === 'error') throw new Error(d.error ?? `HTTP ${r.status}`);
  return d.sql ?? '';
}
