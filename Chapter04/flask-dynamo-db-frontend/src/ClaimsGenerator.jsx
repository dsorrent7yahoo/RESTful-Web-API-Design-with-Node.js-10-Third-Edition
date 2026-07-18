import React, { useState, useEffect, useCallback } from 'react';

export default function ClaimsGenerator({ show, onClose, baseUrl, authToken, catalogEnabled = true, generateOnOpen = false }) {
  const [files,          setFiles]          = useState([]);
  const [loadingFiles,   setLoadingFiles]   = useState(false);
  const [viewKey,        setViewKey]        = useState(null);
  const [viewRows,       setViewRows]       = useState(null);
  const [viewCols,       setViewCols]       = useState([]);
  const [loadingRows,    setLoadingRows]    = useState(false);
  const [error,          setError]          = useState('');
  const [cleaningKey,    setCleaningKey]    = useState(null);
  const [cleanResults,   setCleanResults]   = useState({});
  const [processingAll,  setProcessingAll]  = useState(false);
  const [processAllResult, setProcessAllResult] = useState(null);
  const [generating,     setGenerating]     = useState(false);
  const [generateResult, setGenerateResult] = useState(null);

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

  useEffect(() => {
    if (!show) return;
    if (generateOnOpen) {
      setGenerating(true);
      setGenerateResult(null);
      setError('');
      fetch(baseUrl + '/claims/generate', { method: 'POST', headers: authHeaders })
        .then(r => r.json())
        .then(data => { setGenerateResult(data); })
        .catch(e => { setError(String(e)); })
        .finally(() => { setGenerating(false); fetchFiles(); });
    } else {
      fetchFiles();
    }
  }, [show]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;

  const handleCleanFile = async (file) => {
    setCleaningKey(file.key);
    setError('');
    try {
      const resp = await fetch(baseUrl + '/claims/clean', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: file.key, delete_after: false }),
      });
      const data = await resp.json();
      setCleanResults(prev => ({ ...prev, [file.key]: data }));
    } catch (e) {
      setError(String(e));
    } finally {
      setCleaningKey(null);
    }
  };

  const handleProcessAll = async () => {
    setProcessingAll(true);
    setProcessAllResult(null);
    setError('');
    try {
      const resp = await fetch(baseUrl + '/claims/process-all', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      setProcessAllResult(data);
      fetchFiles();
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessingAll(false);
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
          <h3>{generateOnOpen ? '🧬 synthetic_fhir_claims_lambda' : 'S3 Staging Bucket — Claims CSV Files'}</h3>
          <button className="modal-close" onClick={onClose}>&#x2715;</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* generate banner */}
          {generating && (
            <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '6px',
              padding: '10px 14px', fontSize: '13px', color: '#1d4ed8', fontWeight: 600 }}>
              ⏳ Invoking synthetic_fhir_claims lambda… generating new CSV…
            </div>
          )}
          {generateResult && !generating && (
            <div style={{ background: generateResult.statusCode === 200 ? '#f0fdf4' : '#fef2f2',
              border: '1px solid ' + (generateResult.statusCode === 200 ? '#86efac' : '#fca5a5'),
              borderRadius: '6px', padding: '10px 14px', fontSize: '13px' }}>
              {generateResult.statusCode === 200
                ? <>✅ Generated <code>{generateResult.key?.split('/').pop()}</code> — {generateResult.rows_written} rows → s3://dgs-glue-staging/claims/</>
                : <>❌ {generateResult.message || 'Generate failed'}</>}
            </div>
          )}

          {/* action bar */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              s3://dgs-glue-staging/claims/
            </span>
            <button onClick={fetchFiles} disabled={loadingFiles}
              style={{ background: '#f1f5f9', border: '1px solid #cbd5e1',
                borderRadius: '6px', padding: '6px 14px',
                fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              {loadingFiles ? 'Loading...' : '🔄 Refresh'}
            </button>
          </div>

          {/* error */}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: '6px', padding: '10px 14px',
              fontSize: '13px', color: '#991b1b' }}>
              {error}
            </div>
          )}

          {/* file list */}
          {!loadingFiles && files.length === 0 && (
            <p style={{ fontSize: '13px', color: '#64748b' }}>No files found in bucket.</p>
          )}
          {files.map(f => (
            <div key={f.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', marginBottom: '4px',
                background: viewKey === f.key ? '#f0f9ff' : '#f8fafc',
                border: '1px solid ' + (viewKey === f.key ? '#7dd3fc' : '#e2e8f0'),
                borderRadius: '6px' }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '13px' }}>
                  &#x1F4C4; {f.name}
                </span>
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
                {catalogEnabled && (
                  <button onClick={() => handleCleanFile(f)}
                    disabled={cleaningKey === f.key}
                    style={{ background: cleaningKey === f.key ? '#d1fae5' : 'linear-gradient(135deg,#065f46,#0e7490)',
                      color: cleaningKey === f.key ? '#065f46' : '#fff',
                      border: 'none', borderRadius: '5px',
                      padding: '4px 12px', fontWeight: 600,
                      fontSize: '12px', cursor: cleaningKey === f.key ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap' }}>
                    {cleaningKey === f.key ? '⏳ Cataloging...' : '🗄️ Clean & Catalog'}
                  </button>
                )}
              </div>

              {/* per-file clean result */}
              {cleanResults[f.key] && (
                <div style={{ margin: '0 0 6px', padding: '8px 14px', fontSize: '13px',
                  background: cleanResults[f.key].statusCode === 200 ? '#f0fdf4' : '#fef2f2',
                  border: '1px solid ' + (cleanResults[f.key].statusCode === 200 ? '#86efac' : '#fca5a5'),
                  borderRadius: '6px' }}>
                  {cleanResults[f.key].statusCode === 200
                    ? <>✅ Cataloged as <code>{cleanResults[f.key].glue_database}.{cleanResults[f.key].glue_table}</code></>
                    : <>❌ {cleanResults[f.key].error || cleanResults[f.key].message}</>}
                </div>
              )}

              {viewKey === f.key && (
                <div style={{ marginBottom: '8px', border: '1px solid #bae6fd',
                  borderRadius: '6px', overflow: 'hidden' }}>
                  {loadingRows && (
                    <p style={{ padding: '16px', fontSize: '13px', color: '#64748b' }}>Loading&#x2026;</p>
                  )}
                  {viewRows && viewCols.length > 0 && (
                    <div style={{ overflow: 'auto', maxHeight: '400px' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '12px',
                        width: 'max-content', minWidth: '100%' }}>
                        <thead>
                          <tr>
                            {viewCols.map(c => (
                              <th key={c} style={{
                                position: 'sticky', top: 0, zIndex: 2,
                                background: '#0ea5e9', color: '#fff',
                                padding: '7px 10px', textAlign: 'left',
                                whiteSpace: 'nowrap', fontWeight: 600,
                                borderRight: '1px solid #38bdf8' }}>
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
                                    borderBottom: '1px solid #e2e8f0',
                                    borderRight: '1px solid #f1f5f9',
                                    whiteSpace: 'nowrap',
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
                      {viewRows.length} rows
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
