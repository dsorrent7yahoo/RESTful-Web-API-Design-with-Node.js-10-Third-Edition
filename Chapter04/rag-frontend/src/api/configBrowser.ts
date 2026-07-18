/**
 * configBrowser.ts — Pre-React API client for the Config Browser API (:4009)
 *
 * Pure TypeScript service layer — no framework dependency.
 * Serves project documentation and configuration files with secrets redacted.
 */

const BASE = '/api/config';

export interface FileEntry {
  id: string;
  label: string;
  type: 'markdown' | 'env' | 'json' | 'shell';
  category: 'docs' | 'config' | 'aws' | 'swagger';
  description: string;
  exists: boolean;
  size_bytes: number | null;
}

export interface FileContent {
  id: string;
  label: string;
  type: string;
  content: string;
  redacted: boolean;
  size_bytes: number;
}

/** List all registered documentation and configuration files. */
export async function listConfigFiles(): Promise<FileEntry[]> {
  const resp = await fetch(`${BASE}/files`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** Fetch a file by ID — secrets are automatically redacted by the server. */
export async function getConfigFile(fileId: string): Promise<FileContent> {
  const resp = await fetch(`${BASE}/file/${encodeURIComponent(fileId)}`);
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}
