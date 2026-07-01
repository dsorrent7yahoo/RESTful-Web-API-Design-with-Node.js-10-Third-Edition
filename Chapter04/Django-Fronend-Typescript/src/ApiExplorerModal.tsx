import type { JSX } from 'preact';
import { ApiOption } from './types';

interface ApiExplorerModalProps {
  show: boolean;
  onClose: () => void;
  // auth
  authToken: string;
  handleLogout: () => void;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  loginPassword: string;
  setLoginPassword: (v: string) => void;
  loginLoading: boolean;
  loginStatus: string;
  handleLogin: (e: JSX.TargetedEvent<HTMLFormElement, Event>) => void;
  // form
  baseUrl: string;
  handleBaseUrlChange: (e: JSX.TargetedEvent<HTMLInputElement, Event>) => void;
  selectedId: string;
  setSelectedId: (v: string) => void;
  selected: ApiOption;
  API_OPTIONS: ApiOption[];
  medicationId: string;
  setMedicationId: (v: string) => void;
  medicationPathId: string;
  setMedicationPathId: (v: string) => void;
  patient: string;
  setPatient: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  databaseName: string;
  setDatabaseName: (v: string) => void;
  topN: string;
  setTopN: (v: string) => void;
  queryId: string;
  setQueryId: (v: string) => void;
  queryPatientId: string;
  setQueryPatientId: (v: string) => void;
  queryMedicationId: string;
  setQueryMedicationId: (v: string) => void;
  uploadTableName: string;
  setUploadTableName: (v: string) => void;
  selectedFileName: string;
  handleFileSelection: (e: JSX.TargetedEvent<HTMLInputElement, Event>) => void;
  bodyText: string;
  setBodyText: (v: string) => void;
  resolvedUrlPreview: string;
  runRequest: (e: JSX.TargetedEvent<HTMLFormElement, Event>) => void;
  restartExplorer: () => void;
  loadDynamoTables: (url?: string) => void;
  // response
  isLoading: boolean;
  status: string;
  result: string;
}

export default function ApiExplorerModal({
  show, onClose,
  authToken, handleLogout,
  loginEmail, setLoginEmail, loginPassword, setLoginPassword,
  loginLoading, loginStatus, handleLogin,
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
  isLoading, status, result,
}: ApiExplorerModalProps) {
  if (!show) return null;

  const MED_IDS = ['getAll','getById','getByPatient','getByCode','getByMedicationPath','getPatientsMulti','postMedication','putMedication','deleteMedication','uploadMedCsv','listTables'];
  const FLASK_UPLOAD_IDS = ['uploadFile','uploadJson'];
  const S3_IDS = ['listBuckets','exportS3'];
  const GLUE_IDS = ['listGlueDbs','listGlueTables','registerGlue'];
  const PIPELINE_IDS = ['pipelineAll','pipelineFromCsv'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '760px', width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <h3>🔬 API Explorer</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flex: 1 }}>

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
                  <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.currentTarget.value)}
                    autoComplete="username"
                    style={{ padding: '5px 8px', fontSize: '13px', borderRadius: '5px', border: '1px solid #d1d5db', width: '200px' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                  Password
                  <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.currentTarget.value)}
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
              <select value={selectedId} onChange={(e) => setSelectedId(e.currentTarget.value)}>
                <optgroup label="── Medications ──">
                  {API_OPTIONS.filter((o) => MED_IDS.includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Flask Upload ──">
                  {API_OPTIONS.filter((o) => FLASK_UPLOAD_IDS.includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── S3 Export ──">
                  {API_OPTIONS.filter((o) => S3_IDS.includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Glue ──">
                  {API_OPTIONS.filter((o) => GLUE_IDS.includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Data Lake Pipeline ──">
                  {API_OPTIONS.filter((o) => PIPELINE_IDS.includes(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>

            {selected.needsId && (
              <label>
                Medication ID
                <input value={medicationId} onChange={(e) => setMedicationId(e.currentTarget.value)} placeholder="e.g. patient-encounter-code" />
              </label>
            )}
            {selected.needsMedicationPathId && (
              <label>
                Medication Path ID
                <input value={medicationPathId} onChange={(e) => setMedicationPathId(e.currentTarget.value)} placeholder="medicationId for path" />
              </label>
            )}
            {selected.needsPatient && (
              <label>
                Patient
                <input value={patient} onChange={(e) => setPatient(e.currentTarget.value)} placeholder="patient ID" />
              </label>
            )}
            {selected.needsCode && (
              <label>
                Code
                <input value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="medication code" />
              </label>
            )}
            {selected.needsDatabase && (
              <label>
                Database Name
                <input value={databaseName} onChange={(e) => setDatabaseName(e.currentTarget.value)} placeholder="Glue database name" />
              </label>
            )}
            {selected.needsTopN && (
              <label>
                Top N
                <input type="number" value={topN} onChange={(e) => setTopN(e.currentTarget.value)} min="1" />
              </label>
            )}
            {selected.supportsQueryFilters && (
              <>
                <label>Filter: ID <input value={queryId} onChange={(e) => setQueryId(e.currentTarget.value)} /></label>
                <label>Filter: Patient ID <input value={queryPatientId} onChange={(e) => setQueryPatientId(e.currentTarget.value)} /></label>
                <label>Filter: Medication ID <input value={queryMedicationId} onChange={(e) => setQueryMedicationId(e.currentTarget.value)} /></label>
              </>
            )}
            {(selected.needsFileUpload) && (
              <>
                <label>
                  Table Name
                  <input value={uploadTableName} onChange={(e) => setUploadTableName(e.currentTarget.value)} placeholder="auto-detected from filename" />
                </label>
                <label>
                  CSV File
                  <input type="file" accept=".csv,text/csv" onChange={handleFileSelection} />
                </label>
                {selectedFileName && <div className="meta">Selected: {selectedFileName}</div>}
              </>
            )}
            {selected.needsBody && (
              <label>
                Request Body (JSON)
                <textarea value={bodyText} onChange={(e) => setBodyText(e.currentTarget.value)} rows={8} style={{ fontFamily: 'monospace', fontSize: '12px' }} />
              </label>
            )}

            <div style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px 10px',
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px',
              color: '#334155', wordBreak: 'break-all' }}>
              {resolvedUrlPreview}
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="submit" disabled={isLoading}
                style={{ background: 'linear-gradient(135deg,#0f766e,#065f46)', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '7px 20px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {isLoading ? 'Sending…' : `▶ ${selected.method}`}
              </button>
              <button type="button" onClick={restartExplorer}
                style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                  borderRadius: '6px', padding: '7px 16px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                Reset
              </button>
              <button type="button" onClick={() => loadDynamoTables()}
                style={{ background: '#f0fdf4', color: '#0f766e', border: '1px solid #bbf7d0',
                  borderRadius: '6px', padding: '7px 16px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                Refresh Tables
              </button>
            </div>
          </form>

          {status && (
            <div style={{ marginTop: '14px', padding: '8px 12px', background: '#f8fafc',
              border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              color: status.startsWith('2') ? '#059669' : '#b91c1c' }}>
              {status}
            </div>
          )}
          {result && result !== 'Run a request to see results here.' && (
            <pre style={{ marginTop: '10px', maxHeight: '300px', overflow: 'auto', padding: '12px',
              background: '#0f172a', color: '#e2e8f0', borderRadius: '8px',
              fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {result}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
