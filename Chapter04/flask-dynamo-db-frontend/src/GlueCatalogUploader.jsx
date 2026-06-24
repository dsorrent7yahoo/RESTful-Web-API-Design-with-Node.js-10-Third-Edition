import React, { useState, useRef } from 'react';

/**
 * GlueCatalogUploader
 * Upload one or more CSV files from the browser → S3 → Glue Data Catalog.
 *
 * Props: show, onClose, baseUrl, authToken, buckets (string[])
 */
export default function GlueCatalogUploader({ show, onClose, baseUrl, authToken, buckets = [] }) {
  const [database, setDatabase]     = useState('healthcare_data_lake');
  const [bucket, setBucket]         = useState('dgs-glue-staging');
  const [createBucket, setCreateBucket] = useState(true);
  const [prefix, setPrefix]         = useState('datalake/');
  const [files, setFiles]           = useState([]);     // File objects
  const [loading, setLoading]       = useState(false);
  const [results, setResults]       = useState(null);   // response.results array
  const [error, setError]           = useState('');
  const fileInputRef                = useRef(null);

  if (!show) return null;

  const handleFilePick = (e) => {
    const picked = Array.from(e.target.files || []).filter(f =>
      f.name.toLowerCase().endsWith('.csv')
    );
    setFiles(picked);
    setResults(null);
    setError('');
  };

  const handleUpload = async (e) => {
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
    form.append('createBucket',   createBucket ? 'true' : 'false');
    files.forEach(f => form.append('files[]', f));

    try {
      const resp = await fetch(`${baseUrl}/upload/glue-csv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message || `HTTP ${resp.status}`);
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

      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '820px', width: '95vw', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="modal-header">
          <h3>🗄️ CSV → S3 → Glue Catalog</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flex: 1 }}>

          <p style={{ fontSize: '13px', color: '#475569', marginBottom: '18px', marginTop: 0 }}>
            Select one or more CSV files. Each file will be uploaded to S3 and registered
            as a Glue table (schema inferred from the header row) — ready for Lambda queries.
          </p>

          <form onSubmit={handleUpload} className="form">

            {/* File picker */}
            <label>
              CSV Files
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,text/csv"
                onChange={handleFilePick}
              />
            </label>
            {files.length > 0 && (
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '-8px', marginBottom: '4px' }}>
                {files.length} file{files.length > 1 ? 's' : ''} selected: {files.map(f => f.name).join(', ')}
              </div>
            )}

            {/* S3 Bucket */}
            <label>
              S3 Bucket
              {buckets.length > 0 ? (
                <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
                  <option value="">— select a bucket —</option>
                  {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : (
                <input value={bucket} onChange={(e) => setBucket(e.target.value)}
                  placeholder="e.g. dgs-glue-staging" />
              )}
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', fontWeight: 'normal', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={createBucket} onChange={(e) => setCreateBucket(e.target.checked)}
                style={{ width: 'auto', margin: 0 }} />
              Create bucket if it doesn't exist
            </label>

            {/* Glue database */}
            <label>
              Glue Database Name
              <input value={database} onChange={(e) => setDatabase(e.target.value)}
                placeholder="e.g. healthcare_data_lake" />
            </label>

            {/* S3 prefix */}
            <label>
              S3 Key Prefix
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. datalake/" />
            </label>

            <div className="meta" style={{ marginBottom: '4px' }}>
              Each CSV will be stored at: <code>s3://&#123;bucket&#125;/&#123;prefix&#125;/&#123;table_name&#125;/filename.csv</code>
            </div>

            {error && (
              <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '6px', color: '#b91c1c', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div className="actions">
              <button type="submit" disabled={loading || !files.length}>
                {loading ? 'Uploading…' : `⬆ Upload & Register (${files.length} file${files.length !== 1 ? 's' : ''})`}
              </button>
              <button type="button" onClick={reset}>Reset</button>
            </div>
          </form>

          {/* Progress bar while loading */}
          {loading && (
            <div className="progress-wrap" aria-live="polite" style={{ marginTop: '12px' }}>
              <div className="progress-bar" />
            </div>
          )}

          {/* Results */}
          {results && (
            <div style={{ marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f766e' }}>
                  ✅ {results.summary?.ok ?? 0} registered
                </span>
                {results.summary?.errors > 0 && (
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#b91c1c' }}>
                    ❌ {results.summary.errors} failed
                  </span>
                )}
                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: 'auto' }}>
                  Database: <strong>{results.database}</strong> &nbsp;|&nbsp; Bucket: <strong>{results.bucket}</strong>
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['File', 'Table', 'Columns', 'Action', 'S3 URI', 'Status'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'left',
                        fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(results.results || []).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9',
                      background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '11px' }}>{r.file}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '11px' }}>{r.table}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>{r.columns ?? '—'}</td>
                      <td style={{ padding: '6px 10px', color: '#7c3aed', fontWeight: 600 }}>{r.action ?? '—'}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '10px',
                        maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.s3Uri}>{r.s3Uri ?? '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                          fontWeight: 700, color: statusColor(r.status), background: statusBg(r.status) }}>
                          {r.status === 'ok' ? '✓ ok' : `✗ ${r.message || 'error'}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
