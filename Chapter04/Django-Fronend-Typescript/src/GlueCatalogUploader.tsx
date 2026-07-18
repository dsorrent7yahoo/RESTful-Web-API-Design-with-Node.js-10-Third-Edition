import { useState, useRef } from 'preact/hooks';
import type { JSX } from 'preact';

interface GlueCatalogUploaderProps {
  show: boolean;
  onClose: () => void;
  baseUrl: string;
  authToken: string;
  buckets?: string[];
}

interface UploadResult {
  [key: string]: unknown;
}

const statusColor = (s: string) => s === 'ok' ? '#0f766e' : '#b91c1c';
const statusBg    = (s: string) => s === 'ok' ? '#f0fdf4' : '#fef2f2';

export default function GlueCatalogUploader({ show, onClose, baseUrl, authToken, buckets = [] }: GlueCatalogUploaderProps) {
  const [database, setDatabase] = useState('fhir-table-db');
  const [bucket,   setBucket]   = useState('dgs-glue-staging');
  const [prefix,   setPrefix]   = useState('datalake/');
  const [files,    setFiles]    = useState<File[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [results,  setResults]  = useState<UploadResult | null>(null);
  const [error,    setError]    = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!show) return null;

  const handleFilePick = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const picked = Array.from(e.currentTarget.files ?? []).filter(
      (f) => f.name.toLowerCase().endsWith('.csv'),
    );
    setFiles(picked);
    setResults(null);
    setError('');
  };

  const handleUpload = async (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.preventDefault();
    if (!files.length)  { setError('Select at least one CSV file.'); return; }
    if (!bucket.trim()) { setError('S3 bucket name is required.');   return; }
    setLoading(true);
    setError('');
    setResults(null);
    const form = new FormData();
    form.append('database',       database.trim());
    form.append('bucket',         bucket.trim());
    form.append('prefix',         prefix.trim());
    form.append('createDatabase', 'true');
    files.forEach((f) => form.append('files[]', f));
    try {
      const resp = await fetch(`${baseUrl}/upload/glue-csv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });
      const data: UploadResult = await resp.json();
      if (!resp.ok) {
        setError((data.message as string) || `HTTP ${resp.status}`);
      } else {
        setResults(data);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setResults(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileCount = files.length;
  const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
  const btnLabel  = loading ? 'Uploading...' : `Upload and Register (${fileLabel})`;

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '820px', width: '95vw', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <h3>CSV → S3 → Glue Catalog</h3>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px',
              cursor: 'pointer', color: '#64748b', lineHeight: 1 }}>
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flex: 1 }}>
          <p style={{ fontSize: '13px', color: '#475569', marginBottom: '18px', marginTop: 0 }}>
            Select one or more CSV files. Each file will be uploaded to S3 and
            registered as a Glue table. Schema is inferred from the CSV header row.
          </p>
          <form onSubmit={handleUpload} className="form">
            <label>
              CSV Files
              <input ref={fileInputRef} type="file" multiple accept=".csv,text/csv" onChange={handleFilePick} />
            </label>
            {fileCount > 0 && (
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '-8px', marginBottom: '4px' }}>
                {fileLabel} selected: {files.map((f) => f.name).join(', ')}
              </div>
            )}
            <label>
              Glue Database
              <input value={database} onChange={(e) => setDatabase(e.currentTarget.value)} />
            </label>
            <label>
              S3 Bucket
              {buckets.length > 0 ? (
                <select value={bucket} onChange={(e) => setBucket(e.currentTarget.value)}>
                  {buckets.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : (
                <input value={bucket} onChange={(e) => setBucket(e.currentTarget.value)} />
              )}
            </label>
            <label>
              S3 Prefix
              <input value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} />
            </label>

            {error && (
              <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '6px', padding: '8px 12px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={loading || fileCount === 0}
                style={{ background: 'linear-gradient(135deg,#d97706,#b45309)', color: '#fff',
                  border: 'none', borderRadius: '6px', padding: '7px 18px',
                  fontWeight: 700, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer' }}>
                {btnLabel}
              </button>
              <button type="button" onClick={reset}
                style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                  borderRadius: '6px', padding: '7px 14px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                Reset
              </button>
            </div>
          </form>

          {results && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', color: '#0f766e' }}>
                Upload Results
              </div>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: '8px',
                padding: '12px', fontSize: '12px', overflow: 'auto', maxHeight: '280px' }}>
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
