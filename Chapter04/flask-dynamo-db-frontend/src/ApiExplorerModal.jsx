import React from 'react';

export default function ApiExplorerModal({
  show, onClose,
  // auth
  authToken, handleLogout,
  loginEmail, setLoginEmail, loginPassword, setLoginPassword,
  loginLoading, loginStatus, handleLogin,
  // form
  baseUrl, handleBaseUrlChange,
  selectedId, setSelectedId, selected, API_OPTIONS,
  medicationId, setMedicationId,
  medicationPathId, setMedicationPathId,
  patient, setPatient,
  code, setCode,
  databaseName, setDatabaseName,
  topN, setTopN,
  queryId, setQueryId,
  queryPatientId, setQueryPatientId,
  queryMedicationId, setQueryMedicationId,
  uploadTableName, setUploadTableName,
  selectedFileName, handleFileSelection,
  bodyText, setBodyText,
  resolvedUrlPreview,
  runRequest, restartExplorer, loadDynamoTables,
  // response
  isLoading, status, result,
}) {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '760px', width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <h3>🔬 API Explorer</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flex: 1 }}>

          {/* Auth status bar */}
          {authToken ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px',
              padding: '8px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '8px', fontSize: '13px' }}>
              <span style={{ color: '#059669', fontWeight: 700 }}>✅ Authenticated</span>
              <button type="button" onClick={handleLogout}
                style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                  background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
                  borderRadius: '5px', cursor: 'pointer' }}>
                Log Out
              </button>
            </div>
          ) : (
            <details style={{ marginBottom: '16px', padding: '10px 14px', background: '#fefce8',
              border: '1px solid #fde68a', borderRadius: '8px', fontSize: '13px' }}>
              <summary style={{ fontWeight: 700, color: '#b45309', cursor: 'pointer' }}>
                ⚠️ Not logged in — expand to log in
              </summary>
              <form onSubmit={handleLogin} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '10px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                  Email
                  <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                    autoComplete="username"
                    style={{ padding: '5px 8px', fontSize: '13px', borderRadius: '5px', border: '1px solid #d1d5db', width: '200px' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                  Password
                  <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                    autoComplete="current-password"
                    style={{ padding: '5px 8px', fontSize: '13px', borderRadius: '5px', border: '1px solid #d1d5db', width: '160px' }} />
                </label>
                <button type="submit" disabled={loginLoading}
                  style={{ padding: '6px 16px', fontWeight: 700, fontSize: '13px', background: '#0f766e',
                    color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                  {loginLoading ? 'Logging in...' : 'Log In'}
                </button>
                {loginStatus && <span style={{ color: '#b91c1c', fontSize: '12px' }}>{loginStatus}</span>}
              </form>
            </details>
          )}

          <form onSubmit={runRequest} className="form">
            <label>
              Base URL
              <input value={baseUrl} onChange={handleBaseUrlChange} />
            </label>

            <label>
              API Call
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <optgroup label="── Medications ──">
                  {API_OPTIONS.filter((o) => ['getAll','getById','getByPatient','getByCode','getByMedicationPath','getPatientsMulti','postMedication','putMedication','deleteMedication','uploadMedCsv','listTables'].includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Flask Upload ──">
                  {API_OPTIONS.filter((o) => ['uploadFile','uploadJson'].includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── S3 Export ──">
                  {API_OPTIONS.filter((o) => ['listBuckets','exportS3'].includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Glue Catalog ──">
                  {API_OPTIONS.filter((o) => ['listGlueDbs','listGlueTables','registerGlue'].includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Data Lake ──">
                  {API_OPTIONS.filter((o) => ['pipelineAll', 'pipelineFromCsv'].includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>

            {selected.needsId && (
              <label>
                Medication ID
                <input value={medicationId} onChange={(e) => setMedicationId(e.target.value)} placeholder="Enter id" />
              </label>
            )}
            {selected.needsMedicationPathId && (
              <label>
                Medication Path ID
                <input value={medicationPathId} onChange={(e) => setMedicationPathId(e.target.value)} placeholder="Enter medicationId" />
              </label>
            )}
            {selected.needsPatient && (
              <label>
                Patient
                <input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="Enter patient" />
              </label>
            )}
            {selected.needsCode && (
              <label>
                Code
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" />
              </label>
            )}
            {selected.needsDatabase && (
              <label>
                Glue Database Name
                <input value={databaseName} onChange={(e) => setDatabaseName(e.target.value)} placeholder="e.g. healthcare" />
              </label>
            )}
            {selected.needsTopN && (
              <label>
                topN
                <input value={topN} onChange={(e) => setTopN(e.target.value)} placeholder="e.g. 10" />
              </label>
            )}
            {selected.supportsQueryFilters && (
              <>
                <label>Filter by ID (optional)
                  <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="id filter" />
                </label>
                <label>Filter by Patient ID (optional)
                  <input value={queryPatientId} onChange={(e) => setQueryPatientId(e.target.value)} placeholder="patientId filter" />
                </label>
                <label>Filter by Medication ID (optional)
                  <input value={queryMedicationId} onChange={(e) => setQueryMedicationId(e.target.value)} placeholder="medicationId filter" />
                </label>
              </>
            )}
            {selected.needsFileUpload && (
              <>
                <label>
                  DynamoDB Table Name
                  <input value={uploadTableName} onChange={(e) => setUploadTableName(e.target.value)} placeholder="e.g. medications" />
                </label>
                <label>
                  CSV File
                  <input type="file" accept=".csv,text/csv" onChange={handleFileSelection} />
                </label>
                <div className="meta">{selectedFileName ? `Selected: ${selectedFileName}` : 'No file selected'}</div>
              </>
            )}
            {selected.needsBody && (
              <label>
                Request Body (JSON)
                <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
              </label>
            )}

            <div className="meta">URL: {resolvedUrlPreview}</div>

            <div className="actions">
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Running...' : 'Invoke API'}
              </button>
              <button type="button" onClick={restartExplorer}>Reset</button>
              <button type="button" onClick={() => loadDynamoTables(baseUrl)}>Refresh Tables</button>
            </div>
          </form>

          {/* Response */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: '8px' }}>Response</div>
            <div className="status">Status: {status || 'No request yet'}</div>
            {isLoading && (
              <div className="progress-wrap" aria-live="polite" aria-label="Request in progress">
                <div className="progress-bar" />
              </div>
            )}
            <pre>{result}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
