import React, { useState, useEffect, useCallback } from 'react';

export default function ClaimsGenerator({ show, onClose, baseUrl, authToken }) {
  const [generating,   setGenerating]   = useState(false);
  const [lastResult,   setLastResult]   = useState(null);
  const [files,        setFiles]        = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [viewKey,      setViewKey]      = useState(null);
  const [viewRows,     setViewRows]     = useState(null);
  const [viewCols,     setViewCols]     = useState([]);
  const [loadingRows,  setLoadingRows]  = useState(false);
  const [error,        setError]        = useState('');

  const authHeaders = { Authorization: 'Bearer ' + authToken };

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    setError('');
    try {
      const resp = await fetch(baseUrl + '/claims/files', { headers: authHeaders });
      const data = await resp.json();
      setFiles(data.files || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingFiles(false);
    }
  }, [baseUrl, authToken]);

  useEffect(() => { if (show) fetchFiles(); }, [show, fetchFiles]);

  if (!show) return null;

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const resp = await fetch(baseUrl + '/claims/generate', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message || 'HTTP ' + resp.status);
      } else {
        setLastResult(data);
        fetchFiles();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleView = async (file) => {
    if (viewKey === file.key) { setViewKey(null); setViewRows(null); return; }
    setViewKey(file.key);
    setViewRows(null);
    setViewCols([]);
    setLoadingRows(true);
    try {
      const resp = await fetch(
        baseUrl + '/claims/file?key=' + encodeURIComponent(file.key),
        { headers: authHeaders }
      );
      const data = await resp.json();
      const rows = data.rows || [];
      setViewRows(rows);
      setViewCols(rows.length ? Object.keys(rows[0]) : []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingRows(false);
    }
  };

  const fmtSize = (b) => b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB';
  const fmtDate = (iso) => iso.replace('T', ' ').slice(0, 19);

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-card" onClick={e => e.stopPropagation()}
        style={{ maxWidth: '960px', width: '96vw', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div className="modal-header">
          <h3>FHIR Synthetic Claims Generator</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* action bar */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={handleGenerate} disabled={generating}
              style={{ background: 'linear-gradient(135deg,#0f766e,#0e7490)', color: '#fff',
                border: 'none', borderRadius: '6px', padding: '8px 20px',
                fontWeight: 700, fontSize: '14px',
                cursor: generating ? 'wait' : 'pointer', opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Generating…' : '⚡ Generate 100 Claims'}
            </button>
            <button onClick={fetchFiles} disabled={loadingFiles}
              style={{ background: '#f1f5f9', border: '1px solid #cbd5e1',
                borderRadius: '6px', padding: '8px 14px',
                fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              {loadingFiles ? 'Loading…' : '↻ Refresh Files'}
            </button>
          </div>

          {/* last result */}
          {lastResult && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac',
              borderRadius: '8px', padding: '10px 16px', fontSize: '13px' }}>
              <strong>Written:</strong> {lastResult.key}&ensp;·&ensp;
              <strong>{lastResult.rows_written}</strong> rows&ensp;·&ensp;
              <strong style={{ color: '#b91c1c' }}>{lastResult.rows_missing_date}</strong> missing service_date
            </div>
          )}

          {/* error */}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: '6px', padding: '10px 14px',
              fontSize: '13px', color: '#991b1b' }}>
              {error}
            </div>
          )}

          {/* file list */}
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1e293b' }}>
              s3://dgs-glue-staging/claims/
            </h4>
            {!loadingFiles && files.length === 0 && (
              <p style={{ fontSize: '13px', color: '#64748b' }}>No files found.</p>
            )}
            {files.map(f => (
              <div key={f.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', marginBottom: '4px',
                  background: viewKey === f.key ? '#f0f9ff' : '#f8fafc',
                  border: '1px solid ' + (viewKey === f.key ? '#7dd3fc' : '#e2e8f0'),
                  borderRadius: '6px' }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: '13px' }}>📄 {f.name}</span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{fmtSize(f.size)}</span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{fmtDate(f.lastModified)}</span>
                  <button onClick={() => handleView(f)}
                    style={{ background: viewKey === f.key ? '#0ea5e9' : '#e0f2fe',
                      color: viewKey === f.key ? '#fff' : '#0369a1',
                      border: 'none', borderRadius: '5px',
                      padding: '4px 12px', fontWeight: 600,
                      fontSize: '12px', cursor: 'pointer' }}>
                    {viewKey === f.key ? 'Hide' : 'View'}
                  </button>
                </div>

                {viewKey === f.key && (
                  <div style={{ marginBottom: '8px', border: '1px solid #bae6fd',
                    borderRadius: '6px', overflow: 'hidden' }}>
                    {loadingRows && (
                      <p style={{ padding: '16px', fontSize: '13px', color: '#64748b' }}>Loading…</p>
                    )}
                    {viewRows && viewCols.length > 0 && (
                      <div style={{ overflowX: 'auto', maxHeight: '380px', overflowY: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
                          <thead style={{ position: 'sticky', top: 0, zIndex: 1,
                            background: '#0ea5e9', color: '#fff' }}>
                            <tr>
                              {viewCols.map(c => (
                                <th key={c} style={{ padding: '6px 10px',
                                  textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {viewRows.map((row, ri) => (
                              <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f0f9ff' }}>
                                {viewCols.map(c => {
                                  const missing = c === 'service_date' && !row[c];
                                  return (
                                    <td key={c} style={{ padding: '5px 10px',
                                      borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
                                      color: missing ? '#dc2626' : 'inherit',
                                      fontWeight: missing ? 700 : 'normal' }}>
                                      {missing ? '⚠ missing' : row[c]}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {viewRows && (
                      <div style={{ padding: '6px 12px', fontSize: '12px', color: '#475569',
                        background: '#f0f9ff', borderTop: '1px solid #bae6fd' }}>
                        {viewRows.length} rows &nbsp;·&nbsp;
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>
                          {viewRows.filter(r => !r.service_date).length}
                        </span> missing service_date
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
