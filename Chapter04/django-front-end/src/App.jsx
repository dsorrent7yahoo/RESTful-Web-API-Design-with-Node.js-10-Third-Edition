import React, { useEffect, useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// API options — Django backend routes (port 4002)
// ---------------------------------------------------------------------------
const API_OPTIONS = [
  { id: 'getAll',            label: 'GET /medications',                                   method: 'GET',    path: '/medications',                                  needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: true,  supportsQueryFilters: true,  needsFileUpload: false },
  { id: 'getById',           label: 'GET /medications/id/:id',                            method: 'GET',    path: '/medications/id/{id}',                          needsBody: false, needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByPatient',      label: 'GET /medications/patient/:patient',                  method: 'GET',    path: '/medications/patient/{patient}',                needsBody: false, needsId: false,  needsPatient: true,  needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByCode',         label: 'GET /medications/code/:code',                        method: 'GET',    path: '/medications/code/{code}',                      needsBody: false, needsId: false,  needsPatient: false, needsCode: true,  needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByMedicationPath', label: 'GET /medications/medication/:medicationId',        method: 'GET',    path: '/medications/medication/{medicationId}',        needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: true,  needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getPatientsMulti',  label: 'GET /medications/patients/multiple-medications',     method: 'GET',    path: '/medications/patients/multiple-medications',    needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: true,  supportsQueryFilters: false, needsFileUpload: false },
  { id: 'postMedication',    label: 'POST /medications',                                  method: 'POST',   path: '/medications',                                  needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'putMedication',     label: 'PUT /medications/:id',                               method: 'PUT',    path: '/medications/{id}',                             needsBody: true,  needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'deleteMedication',  label: 'DELETE /medications/:id',                            method: 'DELETE', path: '/medications/{id}',                             needsBody: false, needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'uploadMedCsv',      label: 'POST /medications/upload  (JSON csvContent)',        method: 'POST',   path: '/medications/upload',                           needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: true  },
  { id: 'listTables',        label: 'GET /tables',                                        method: 'GET',    path: '/tables',                                       needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
];

const DEFAULT_BODY = {
  id: 'patient-encounter-code',
  start: '2022-11-07T00:00:00.000Z',
  stop: '2022-11-07T00:00:00.000Z',
  patient: 'patient-123',
  payer: 'payer-123',
  encounter: 'encounter-123',
  code: 'med-code-123',
  description: 'Medication sample',
  baseCost: 10.5,
  payerCoverage: 8.2,
  dispenses: 1,
  totalCost: 10.5,
  reasonCode: 'reason-1',
  reasonDescription: 'Demo payload',
};

const TABLE_COLUMNS = [
  'id', 'start', 'stop', 'patient', 'payer', 'encounter',
  'code', 'description', 'baseCost', 'payerCoverage',
  'dispenses', 'totalCost', 'reasonCode', 'reasonDescription',
];

const BACKEND_PRESETS = {
  cmdline: 'http://localhost:4002',
  docker:  'http://localhost:4002',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function prettyJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}
function resolveBackendMode(url) {
  const n = normalizeBaseUrl(url);
  const entry = Object.entries(BACKEND_PRESETS).find(([, v]) => normalizeBaseUrl(v) === n);
  return entry ? entry[0] : 'custom';
}
function normalizeRowsFromResponse(payload) {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === 'object');
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.items))   return payload.items.filter((r) => r && typeof r === 'object');
    if (Array.isArray(payload.data))    return payload.data.filter((r) => r && typeof r === 'object');
    if (Array.isArray(payload.tables))  return payload.tables.map((t) => ({ table: t }));
    return [payload];
  }
  return [];
}
function inferTableColumns(rows) {
  const keys = [];
  rows.forEach((row) => Object.keys(row || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  return keys.length === 0 ? TABLE_COLUMNS : keys;
}
function chunkTableNames(names, size) {
  const rows = [];
  for (let i = 0; i < names.length; i += size) rows.push(names.slice(i, i + size));
  return rows;
}
function inferTableNameFromFileName(fileName) {
  return String(fileName || '').replace(/\.[^/.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'uploaded_data';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function App() {
  const [authToken, setAuthToken]         = useState(() => localStorage.getItem('djangoToken') || '');
  const [loginEmail, setLoginEmail]       = useState('react-dgs@yahoo.com');
  const [loginPassword, setLoginPassword] = useState('python');
  const [loginStatus, setLoginStatus]     = useState('');
  const [loginLoading, setLoginLoading]   = useState(false);

  const [baseUrl, setBaseUrl]             = useState(BACKEND_PRESETS.cmdline);
  const [backendMode, setBackendMode]     = useState('cmdline');
  const [selectedId, setSelectedId]       = useState('getAll');
  const [medicationId, setMedicationId]   = useState('');
  const [medicationPathId, setMedicationPathId] = useState('');
  const [patientOptions, setPatientOptions] = useState([]);
  const [patient, setPatient]             = useState('');
  const [codeOptions, setCodeOptions]     = useState([]);
  const [code, setCode]                   = useState('');
  const [topN, setTopN]                   = useState('10');
  const [queryId, setQueryId]             = useState('');
  const [queryPatientId, setQueryPatientId] = useState('');
  const [queryMedicationId, setQueryMedicationId] = useState('');
  const [uploadTableName, setUploadTableName] = useState('');
  const [selectedFile, setSelectedFile]   = useState(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [medicationOptions, setMedicationOptions] = useState([]);
  const [bodyText, setBodyText]           = useState(prettyJson(DEFAULT_BODY));
  const [result, setResult]               = useState('Run a request to see results here.');
  const [status, setStatus]               = useState('');
  const [isLoading, setIsLoading]         = useState(false);
  const [tableRows, setTableRows]         = useState([]);
  const [tableColumns, setTableColumns]   = useState(TABLE_COLUMNS);
  const [dynamoTables, setDynamoTables]   = useState([]);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showApiPanel, setShowApiPanel]   = useState(true);

  const selected = useMemo(
    () => API_OPTIONS.find((o) => o.id === selectedId) || API_OPTIONS[0],
    [selectedId],
  );
  const dynamoTableRows = useMemo(() => chunkTableNames(dynamoTables, 5), [dynamoTables]);
  const normalizedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);

  function authHeaders(extra = {}) {
    return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
  }

  // Auto-update body template
  useEffect(() => {
    if (['postMedication', 'putMedication'].includes(selectedId)) {
      setBodyText(prettyJson(DEFAULT_BODY));
    }
  }, [selectedId]);

  // Load options on backend change
  useEffect(() => {
    loadOptions(baseUrl);
    loadDynamoTables(baseUrl);
  }, [baseUrl, authToken]);

  function setBackendTarget(mode) {
    const url = BACKEND_PRESETS[mode] || baseUrl;
    setBackendMode(mode);
    setBaseUrl(url);
  }
  function handleBaseUrlChange(e) {
    const next = e.target.value;
    setBaseUrl(next);
    setBackendMode(resolveBackendMode(next));
  }

  async function loadDynamoTables(currentBaseUrl) {
    if (!authToken) return;
    try {
      const res = await fetch(`${normalizeBaseUrl(currentBaseUrl || baseUrl)}/tables`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setDynamoTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch { /* silent */ }
  }

  async function loadOptions(currentBaseUrl) {
    if (!authToken) return;
    try {
      const base = normalizeBaseUrl(currentBaseUrl);
      const res = await fetch(`${base}/medications?limit=250`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

      const medChoices = items.filter((i) => i?.id).map((i) => ({
        value: String(i.id),
        label: `${i.id} — ${i.description || i.code || 'Unnamed'}`,
      }));
      const ptChoices = [...new Set(items.map((i) => i?.patient).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const codeChoices = [...new Set(items.map((i) => i?.code).filter(Boolean))].sort((a, b) => a.localeCompare(b));

      setMedicationOptions(medChoices);
      setPatientOptions(ptChoices);
      setCodeOptions(codeChoices);
      if (medChoices.length > 0) { setMedicationId(medChoices[0].value); setMedicationPathId(medChoices[0].value); }
      if (ptChoices.length > 0) setPatient(ptChoices[0]);
      if (codeChoices.length > 0) setCode(codeChoices[0]);
    } catch { /* silent */ }
  }

  // Computed path
  const resolvedPath = useMemo(() => {
    if (selected.needsId)              return selected.path.replace('{id}',           encodeURIComponent(medicationId.trim()));
    if (selected.needsPatient)         return selected.path.replace('{patient}',      encodeURIComponent(patient.trim()));
    if (selected.needsCode)            return selected.path.replace('{code}',         encodeURIComponent(code.trim()));
    if (selected.needsMedicationPathId) return selected.path.replace('{medicationId}', encodeURIComponent(medicationPathId.trim()));
    return selected.path;
  }, [selected, medicationId, patient, code, medicationPathId]);

  const requestQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (selected.needsTopN && topN.trim()) params.set('topN', topN.trim());
    if (selected.supportsQueryFilters) {
      if (queryId.trim())           params.set('id',           queryId.trim());
      if (queryPatientId.trim())    params.set('patientId',    queryPatientId.trim());
      if (queryMedicationId.trim()) params.set('medicationId', queryMedicationId.trim());
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [selected, topN, queryId, queryPatientId, queryMedicationId]);

  const resolvedUrlPreview = useMemo(
    () => `${normalizedBaseUrl}${resolvedPath}${requestQueryString}`,
    [normalizedBaseUrl, resolvedPath, requestQueryString],
  );

  function handleFileSelection(e) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setSelectedFileName(file ? file.name : '');
    if (file && !uploadTableName.trim()) setUploadTableName(inferTableNameFromFileName(file.name));
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginStatus('Logging in...');
    try {
      const res = await fetch(`${normalizedBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.accessToken || data.token)) {
        const tok = data.accessToken || data.token;
        localStorage.setItem('djangoToken', tok);
        setAuthToken(tok);
        setLoginStatus(`Logged in as ${data.user?.email || loginEmail}`);
      } else {
        setLoginStatus(data.message || data.error || `Login failed (${res.status})`);
      }
    } catch (err) {
      setLoginStatus(`Error: ${err.message}`);
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('djangoToken');
    setAuthToken('');
    setLoginStatus('Logged out');
  }

  async function runRequest(e) {
    e.preventDefault();
    if (selected.needsId && !medicationId.trim())                  { setStatus('Medication ID is required.'); return; }
    if (selected.needsPatient && !patient.trim())                   { setStatus('Patient is required.'); return; }
    if (selected.needsCode && !code.trim())                         { setStatus('Code is required.'); return; }
    if (selected.needsMedicationPathId && !medicationPathId.trim()) { setStatus('Medication ID is required.'); return; }

    const url  = normalizedBaseUrl + resolvedPath + requestQueryString;
    const opts = { method: selected.method, headers: authHeaders() };

    if (selected.needsFileUpload) {
      const payload = {};
      if (uploadTableName.trim()) payload.tableName = uploadTableName.trim();
      if (selectedFile) {
        try { payload.csvContent = await selectedFile.text(); payload.fileName = selectedFile.name; }
        catch { setStatus('Unable to read selected CSV file.'); return; }
      }
      opts.headers = authHeaders({ 'Content-Type': 'application/json' });
      opts.body = JSON.stringify(payload);
    } else if (selected.needsBody) {
      try {
        opts.headers = authHeaders({ 'Content-Type': 'application/json' });
        opts.body = JSON.stringify(JSON.parse(bodyText));
      } catch { setStatus('Invalid JSON body.'); return; }
    }

    setIsLoading(true);
    setStatus('Sending request...');
    setTableRows([]);

    try {
      const res = await fetch(url, opts);
      let parsed;
      try { parsed = await res.json(); } catch { parsed = await res.text(); }
      setStatus(`${res.status} ${res.statusText}`);
      setResult(prettyJson(parsed));
      const rows = normalizeRowsFromResponse(parsed);
      if (rows.length > 0) {
        setTableColumns(inferTableColumns(rows));
        setTableRows(rows);
        setShowResultModal(true);
      }
      if (['POST', 'PUT', 'DELETE'].includes(selected.method)) loadOptions(baseUrl);
      if (selected.id === 'uploadMedCsv' && res.ok) loadDynamoTables(baseUrl);
    } catch (err) {
      setStatus('Request failed');
      setResult(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Login gate
  // ──────────────────────────────────────────────────────────────────────────
  if (!authToken) {
    return (
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #2e1065 0%, #4c1d95 50%, #5b21b6 100%)',
      }}>
        <div style={{
          background: '#1e1040', border: '1px solid #6d28d9', borderRadius: '14px',
          padding: '40px 48px', width: '100%', maxWidth: '420px',
          boxShadow: '0 25px 60px rgba(109,40,217,0.45)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '38px', marginBottom: '10px' }}>💊</div>
            <h1 style={{ fontSize: '21px', fontWeight: 800, color: '#f3e8ff', margin: '0 0 6px' }}>
              Django FHIR Demo
            </h1>
            <p style={{ fontSize: '13px', color: '#a78bfa', margin: 0 }}>
              localhost:4002 — sign in to continue
            </p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#c4b5fd' }}>
              Email
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="username" required
                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #6d28d9',
                  background: '#2e1065', color: '#f3e8ff', fontSize: '14px', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#c4b5fd' }}>
              Password
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password" required
                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #6d28d9',
                  background: '#2e1065', color: '#f3e8ff', fontSize: '14px', outline: 'none' }} />
            </label>
            {loginStatus && (
              <div style={{
                fontSize: '13px',
                color: loginStatus.startsWith('Logged') ? '#a78bfa' : '#f87171',
                background: loginStatus.startsWith('Logged') ? 'rgba(109,40,217,0.2)' : 'rgba(127,29,29,0.3)',
                border: `1px solid ${loginStatus.startsWith('Logged') ? '#7c3aed' : '#b91c1c'}`,
                borderRadius: '6px', padding: '8px 12px',
              }}>
                {loginStatus}
              </div>
            )}
            <button type="submit" disabled={loginLoading} style={{
              marginTop: '4px', padding: '12px', borderRadius: '8px', border: 'none',
              background: loginLoading ? '#4c1d95' : 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              color: '#fff', fontWeight: 700, fontSize: '15px',
              cursor: loginLoading ? 'not-allowed' : 'pointer',
              boxShadow: loginLoading ? 'none' : '0 4px 20px rgba(124,58,237,0.4)',
            }}>
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Main app
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <main className="page">

      {/* ── Hero ── */}
      <section className="hero panel">
        <div>
          <p className="eyebrow">Django DynamoDB</p>
          <h1>ReactJs Test-Client for Django APIs</h1>
          <p className="lede">
            Drive the Django medication routes and authentication from a single React UI.
            All requests include the JWT stored in{' '}
            <code>localStorage.djangoToken</code>.
          </p>
          <div className="hero-status" aria-live="polite">
            <span className={isLoading ? 'status-dot busy' : 'status-dot'} />
            <span>{isLoading ? 'Request in progress...' : 'Ready'}</span>
          </div>

          {/* Backend selector */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7c3aed', marginBottom: '8px' }}>
              Connect to backend
            </div>
            <div className="backend-group">
              <button type="button" className={backendMode === 'cmdline' ? 'backend-option active' : 'backend-option'} onClick={() => setBackendTarget('cmdline')}>
                Command Line
              </button>
              <button type="button" className={backendMode === 'docker' ? 'backend-option active' : 'backend-option'} onClick={() => setBackendTarget('docker')}>
                Docker
              </button>
              <button type="button" className={backendMode === 'custom' ? 'backend-option active' : 'backend-option'} onClick={() => setBackendMode('custom')}>
                Custom
              </button>
            </div>
            {backendMode === 'custom' && (
              <input
                style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '8px', border: '1.5px solid #c4b5fd', fontSize: '13px', width: '100%', background: '#faf5ff', color: '#1e293b' }}
                value={baseUrl}
                onChange={handleBaseUrlChange}
                placeholder="http://localhost:4002"
              />
            )}
            <div style={{ fontSize: '12px', color: '#7c3aed', marginTop: '6px' }}>
              {backendMode !== 'custom' ? <>localhost:4002 — {backendMode === 'docker' ? 'docker compose up' : 'python manage.py runserver'}</> : baseUrl}
            </div>
          </div>

          <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <a href={`${normalizedBaseUrl}/api-docs`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '6px',
                background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', fontWeight: 700, fontSize: '13px',
                textDecoration: 'none' }}>
              📖 Swagger UI
            </a>
            <button type="button" onClick={() => { setShowApiPanel(!showApiPanel); }}
              style={{ background: 'linear-gradient(135deg,#6d28d9,#4c1d95)' }}>
              {showApiPanel ? '▲ Hide Explorer' : '▼ Show Explorer'}
            </button>
            <button type="button" onClick={handleLogout}
              style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)' }}>
              Log Out
            </button>
          </div>
        </div>

        <div className="hero-badge">
          <span>Backend</span>
          <strong>{backendMode === 'docker' ? 'Docker' : backendMode === 'custom' ? 'Custom' : 'Cmd'}</strong>
          <span className="hero-badge-url">{normalizedBaseUrl || 'localhost:4002'}</span>
        </div>
      </section>

      {/* ── API Explorer ── */}
      {showApiPanel && (
        <>
          <section className="panel">
            <h2>API Explorer</h2>
            <div className="form">
              <label>
                Endpoint
                <select className="api-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                  {API_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>

              {selected.needsId && (
                <label>
                  Medication ID
                  <select className="api-select" value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
                    {medicationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    <option value="">— enter manually —</option>
                  </select>
                  {(!medicationOptions.length || !medicationId) && (
                    <input value={medicationId} onChange={(e) => setMedicationId(e.target.value)} placeholder="medication-id" />
                  )}
                </label>
              )}

              {selected.needsMedicationPathId && (
                <label>
                  Medication ID (path)
                  <select className="api-select" value={medicationPathId} onChange={(e) => setMedicationPathId(e.target.value)}>
                    {medicationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    <option value="">— enter manually —</option>
                  </select>
                </label>
              )}

              {selected.needsPatient && (
                <label>
                  Patient
                  <select className="api-select" value={patient} onChange={(e) => setPatient(e.target.value)}>
                    {patientOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}

              {selected.needsCode && (
                <label>
                  Code
                  <select className="api-select" value={code} onChange={(e) => setCode(e.target.value)}>
                    {codeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}

              {selected.needsTopN && (
                <label>
                  Top N results
                  <input type="number" value={topN} onChange={(e) => setTopN(e.target.value)} min="1" />
                </label>
              )}

              {selected.supportsQueryFilters && (
                <>
                  <label>Filter by ID <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="optional" /></label>
                  <label>Filter by Patient ID <input value={queryPatientId} onChange={(e) => setQueryPatientId(e.target.value)} placeholder="optional" /></label>
                  <label>Filter by Medication ID <input value={queryMedicationId} onChange={(e) => setQueryMedicationId(e.target.value)} placeholder="optional" /></label>
                </>
              )}

              {selected.needsBody && (
                <label>
                  Request Body (JSON)
                  <textarea rows={8} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
                </label>
              )}

              {selected.needsFileUpload && (
                <>
                  <label>
                    Table Name
                    <input value={uploadTableName} onChange={(e) => setUploadTableName(e.target.value)} placeholder="medications" />
                  </label>
                  <label>
                    CSV File
                    <input type="file" accept=".csv,text/csv" onChange={handleFileSelection} />
                  </label>
                  {selectedFileName && <div className="meta">📎 {selectedFileName}</div>}
                </>
              )}

              <div className="url-preview">{resolvedUrlPreview}</div>

              <button type="button" onClick={runRequest} disabled={isLoading}>
                {isLoading ? '⏳ Sending...' : `▶ Send ${selected.method}`}
              </button>
            </div>
          </section>

          {/* ── Result panel ── */}
          <section className="panel">
            <h2>Response</h2>
            {status && <div className="status-bar" style={{ marginBottom: '10px' }}>{status}</div>}
            <pre className="result-box">{result}</pre>
            {tableRows.length > 0 && (
              <button type="button" style={{ marginTop: '10px' }} onClick={() => setShowResultModal(true)}>
                🔍 View as Table ({tableRows.length} rows)
              </button>
            )}
          </section>
        </>
      )}

      {/* ── Loaded Tables ── */}
      <section className="panel loaded-tables-panel">
        <h2>DynamoDB Tables</h2>
        <div className="meta">Tables on the current Django backend. Refreshes after uploads or backend switch.</div>
        {dynamoTables.length === 0 ? (
          <div className="meta" style={{ marginTop: '12px' }}>No tables loaded yet.</div>
        ) : (
          <div className="dynamo-table-grid" style={{ marginTop: '12px' }}>
            {dynamoTableRows.map((row, ri) => (
              <div className="dynamo-table-row" key={`row-${ri}`}>
                {row.map((t) => <span className="dynamo-table-name" key={t}>{t}</span>)}
              </div>
            ))}
          </div>
        )}
        <button type="button" style={{ marginTop: '12px' }} onClick={() => loadDynamoTables(baseUrl)}>
          ↻ Refresh
        </button>
      </section>

      {/* ── Result Table Modal ── */}
      {showResultModal && (
        <div className="modal-backdrop" onClick={() => setShowResultModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Results — {tableRows.length} row{tableRows.length !== 1 ? 's' : ''}</h3>
              <button type="button" onClick={() => setShowResultModal(false)}>✕ Close</button>
            </div>
            <div className="modal-body">
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>{tableColumns.map((col) => <th key={col}>{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i}>
                        {tableColumns.map((col) => (
                          <td key={col} title={String(row[col] ?? '')}>
                            {row[col] === null || row[col] === undefined ? '-' : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
