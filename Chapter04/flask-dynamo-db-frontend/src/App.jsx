import React, { useEffect, useMemo, useState } from 'react';
import ApiExplorerModal from './ApiExplorerModal';

// ── SSO bootstrap — reads ?sso= JWT injected by the landing-page card link ──
// Runs at module level (before first render) so useState initialisers below
// read the already-written localStorage values and skip the login form.
;(function applySSOToken() {
  const params = new URLSearchParams(window.location.search);
  const sso = params.get('sso');
  if (!sso) return;
  localStorage.setItem('healthCareToken', sso);
  localStorage.setItem('healthCareSSOMode', 'docker');
  params.delete('sso');
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
})();
import SwaggerDocsButton from './SwaggerDocsButton';
import DocsSourceModal from './DocsSourceModal';
import FileContentViewer from './FileContentViewer';
import GlueCatalogUploader from './GlueCatalogUploader';
import ClaimsGenerator from './ClaimsGenerator';
import SQSMonitor from './SQSMonitor';
import AthenaClient from './AthenaClient';
import ClaimsPipelineModal from './ClaimsPipelineModal';

// ---------------------------------------------------------------------------
// API options — medications (same routes as Node backend) + Flask-specific
// ---------------------------------------------------------------------------
const API_OPTIONS = [
  // Medications
  { id: 'getAll',            label: 'GET /medications/',                                    method: 'GET',    path: '/medications/',                                    needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: true,  supportsQueryFilters: true,  needsFileUpload: false },
  { id: 'getById',           label: 'GET /medications/id/:id',                              method: 'GET',    path: '/medications/id/{id}',                             needsBody: false, needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByPatient',      label: 'GET /medications/patient/:patient',                    method: 'GET',    path: '/medications/patient/{patient}',                   needsBody: false, needsId: false,  needsPatient: true,  needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByCode',         label: 'GET /medications/code/:code',                          method: 'GET',    path: '/medications/code/{code}',                         needsBody: false, needsId: false,  needsPatient: false, needsCode: true,  needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByMedicationPath', label: 'GET /medications/medication/:medicationId',          method: 'GET',    path: '/medications/medication/{medicationId}',           needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: true,  needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getPatientsMulti',  label: 'GET /medications/patients/multiple-medications',       method: 'GET',    path: '/medications/patients/multiple-medications',       needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: true,  supportsQueryFilters: false, needsFileUpload: false },
  { id: 'postMedication',    label: 'POST /medications/',                                   method: 'POST',   path: '/medications/',                                    needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'putMedication',     label: 'PUT /medications/:id',                                 method: 'PUT',    path: '/medications/{id}',                                needsBody: true,  needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'deleteMedication',  label: 'DELETE /medications/:id',                              method: 'DELETE', path: '/medications/{id}',                                needsBody: false, needsId: true,   needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'uploadMedCsv',      label: 'POST /medications/upload  (JSON csvContent)',          method: 'POST',   path: '/medications/upload',                              needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: true  },
  { id: 'listTables',        label: 'GET /tables',                                          method: 'GET',    path: '/tables',                                          needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  // Flask generic upload
  { id: 'uploadFile',        label: 'POST /upload/file  (File Picker → Multipart)',         method: 'POST',   path: '/upload/file',                                     needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'uploadJson',        label: 'POST /upload  (JSON csvPath)',                         method: 'POST',   path: '/upload',                                          needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  // Flask export — S3
  { id: 'listBuckets',       label: 'GET /export/s3/buckets',                               method: 'GET',    path: '/export/s3/buckets',                               needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'exportS3',          label: 'POST /export/s3  (DynamoDB → S3)',                     method: 'POST',   path: '/export/s3',                                       needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  // Flask export — Glue
  { id: 'listGlueDbs',       label: 'GET /export/glue/databases',                           method: 'GET',    path: '/export/glue/databases',                           needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'listGlueTables',    label: 'GET /export/glue/databases/{database}/tables',         method: 'GET',    path: '/export/glue/databases/{database}/tables',         needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: true,  needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'registerGlue',      label: 'POST /export/glue  (Register S3 path in Glue)',        method: 'POST',   path: '/export/glue',                                     needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  // Data Lake pipeline
  { id: 'pipelineAll',     label: '🚀 POST /export/pipeline/all  (DynamoDB → S3 + Glue)',  method: 'POST', path: '/export/pipeline/all',      needsBody: true, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'pipelineFromCsv', label: '📂 POST /export/pipeline/from-csv  (CSV → S3 + Glue)',  method: 'POST', path: '/export/pipeline/from-csv', needsBody: true, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
];

// ---------------------------------------------------------------------------
// Default body templates
// ---------------------------------------------------------------------------
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

const DEFAULT_EXPORT_S3_BODY = {
  tableName: 'allergies',
  bucket: 'healthcare-exports-005905648819',
  prefix: 'dynamodb-exports/',
  format: 'csv',
};

const DEFAULT_PIPELINE_ALL_BODY = {
  bucket: 'healthcare-exports-005905648819',
  glueDatabase: 'healthcare_data_lake',
  prefix: 'datalake/',
  format: 'csv',
  createBucket: false,
  createDatabase: true,
};

const DEFAULT_PIPELINE_CSV_BODY = {
  bucket: 'healthcare-exports-005905648819',
  glueDatabase: 'healthcare_data_lake',
  prefix: 'datalake/',
  csvDir: '/coherent-11-07-2022/csv',
  createBucket: false,
  createDatabase: true,
};

const DEFAULT_REGISTER_GLUE_BODY = {
  tableName: 'allergies',
  s3Uri: 's3://healthcare-exports-005905648819/dynamodb-exports/allergies/',
  database: 'healthcare',
  format: 'csv',
};

const DEFAULT_UPLOAD_JSON_BODY = {
  tableName: 'medications',
  csvPath: 'C:/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/coherent-11-07-2022/csv/medications.csv',
};

const TABLE_COLUMNS = [
  'id', 'start', 'stop', 'patient', 'payer', 'encounter',
  'code', 'description', 'baseCost', 'payerCoverage',
  'dispenses', 'totalCost', 'reasonCode', 'reasonDescription',
];

// True when the page is served from a remote host (Fargate or any non-localhost)
const IS_FARGATE = !['localhost', '127.0.0.1'].includes(window.location.hostname);
// Allow explicit API base URL override for deployed environments.
const DEFAULT_DEPLOYED_FLASK_ORIGIN = 'http://sorrentino-fargate-fhir-demo-alb-1996236158.us-east-1.elb.amazonaws.com';
const DEPLOYED_FLASK_ORIGIN = (import.meta.env.VITE_FLASK_API_URL || DEFAULT_DEPLOYED_FLASK_ORIGIN)
  .trim()
  .replace(/\/$/, '');

const BACKEND_PRESETS = {
  cmdline: 'http://localhost:4001',   // python app.py
  docker:  'http://localhost:4001',   // docker compose
  aws:     DEPLOYED_FLASK_ORIGIN,
};
// Landing page: port 5180 locally, root domain on EC2 / production
const LANDING_URL = window.location.hostname === 'localhost'
  ? `${window.location.protocol}//localhost:5180`
  : `${window.location.protocol}//${window.location.hostname}`;

// ---------------------------------------------------------------------------
// Pure helpers
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

function getBackendModeLabel(mode) {
  if (mode === 'cmdline') return 'Command Line';
  if (mode === 'docker')  return 'Docker';
  if (mode === 'aws')     return 'AWS Fargate';
  return 'Custom';
}

function normalizeRowsFromResponse(payload) {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === 'object');
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.items))   return payload.items.filter((r) => r && typeof r === 'object');
    if (Array.isArray(payload.data))    return payload.data.filter((r) => r && typeof r === 'object');
    if (Array.isArray(payload.results)) return payload.results.filter((r) => r && typeof r === 'object');
    if (Array.isArray(payload.tables))  return payload.tables.map((t) => ({ table: t }));
    if (Array.isArray(payload.buckets)) return payload.buckets.map((b) => ({ bucket: b }));
    return [payload];
  }
  return [];
}

function inferTableColumns(rows) {
  const keys = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => { if (!keys.includes(key)) keys.push(key); });
  });
  return keys.length === 0 ? TABLE_COLUMNS : keys;
}

function getCellValue(row, key) {
  const value = row[key];
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const names = value
        .map((item) => item.medicationName || item.description || item.name || item.medicationId)
        .filter(Boolean).map(String).sort((a, b) => a.localeCompare(b));
      if (names.length > 0) {
        return (
          <span>
            {names.map((name, i) => (
              <span key={`${name}-${i}`} className={i % 2 === 1 ? 'medication-name-alt' : ''}>
                {i > 0 ? ', ' : ''}{name}
              </span>
            ))}
          </span>
        );
      }
      return JSON.stringify(value);
    }
    return value.join(', ');
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function inferTableNameFromFileName(fileName) {
  return String(fileName || '').replace(/\.[^/.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'uploaded_data';
}

function chunkTableNames(names, size) {
  const rows = [];
  for (let i = 0; i < names.length; i += size) rows.push(names.slice(i, i + size));
  return rows;
}

// Default body per endpoint id
function defaultBodyFor(id) {
  if (id === 'exportS3')     return DEFAULT_EXPORT_S3_BODY;
  if (id === 'registerGlue') return DEFAULT_REGISTER_GLUE_BODY;
  if (id === 'uploadJson')   return DEFAULT_UPLOAD_JSON_BODY;
  if (id === 'pipelineAll')     return DEFAULT_PIPELINE_ALL_BODY;
  if (id === 'pipelineFromCsv') return DEFAULT_PIPELINE_CSV_BODY;
  return DEFAULT_BODY;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function App() {
  const useAwsByDefault = Boolean(import.meta.env.VITE_FLASK_API_URL) || window.location.hostname === 'localhost';
  const [authToken, setAuthToken]               = useState(() => localStorage.getItem('healthCareToken') || '');
  const [loginEmail, setLoginEmail]             = useState('react-dgs@yahoo.com');
  const [loginPassword, setLoginPassword]       = useState('python');
  const [loginStatus, setLoginStatus]           = useState('');
  const [loginLoading, setLoginLoading]         = useState(false);

  const [baseUrl, setBaseUrl]                   = useState(useAwsByDefault ? BACKEND_PRESETS.aws : (IS_FARGATE ? BACKEND_PRESETS.aws : BACKEND_PRESETS.cmdline));
  const [backendMode, setBackendMode]           = useState(useAwsByDefault ? 'aws' : (IS_FARGATE ? 'aws' : 'cmdline'));
  const [loginMode, setLoginMode]               = useState(() => localStorage.getItem('healthCareSSOMode') || null);
  const [selectedId, setSelectedId]             = useState('getAll');
  const [medicationId, setMedicationId]         = useState('');
  const [medicationPathId, setMedicationPathId] = useState('');
  const [patientOptions, setPatientOptions]     = useState([]);
  const [patient, setPatient]                   = useState('');
  const [codeOptions, setCodeOptions]           = useState([]);
  const [code, setCode]                         = useState('');
  const [databaseName, setDatabaseName]         = useState('');
  const [topN, setTopN]                         = useState('10');
  const [queryId, setQueryId]                   = useState('');
  const [queryPatientId, setQueryPatientId]     = useState('');
  const [queryMedicationId, setQueryMedicationId] = useState('');
  const [uploadTableName, setUploadTableName]   = useState('');
  const [selectedFile, setSelectedFile]         = useState(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [medicationOptions, setMedicationOptions] = useState([]);
  const [bodyText, setBodyText]                 = useState(prettyJson(DEFAULT_BODY));
  const [result, setResult]                     = useState('Run a request to see results here.');
  const [status, setStatus]                     = useState('');
  const [isLoading, setIsLoading]               = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showLoaderModal, setShowLoaderModal]   = useState(false);
  const [tableRows, setTableRows]               = useState([]);
  const [tableColumns, setTableColumns]         = useState(TABLE_COLUMNS);
  const [dynamoTables, setDynamoTables]         = useState([]);

  // S3 Bucket browser
  const [showBucketListModal, setShowBucketListModal]   = useState(false);
  const [bucketList, setBucketList]                     = useState([]);
  const [selectedBucket, setSelectedBucket]             = useState('');
  const [showBucketBrowser, setShowBucketBrowser]       = useState(false);
  const [browserBucket, setBrowserBucket]               = useState('');
  const [bucketObjects, setBucketObjects]               = useState([]);
  const [bucketObjectsLoading, setBucketObjectsLoading] = useState(false);
  const [bucketObjectsError, setBucketObjectsError]     = useState('');
  const [browserPrefix, setBrowserPrefix]               = useState('');
  const [deletingBucket, setDeletingBucket]             = useState(false);

  // Data Lake pipeline
  const [showPipelineModal, setShowPipelineModal]       = useState(false);
  const [pipelineEvents, setPipelineEvents]             = useState([]);
  const [pipelineRunning, setPipelineRunning]           = useState(false);

  // Glue Data Lake tables
  const [glueTables, setGlueTables]                     = useState([]);
  const [glueDbName, setGlueDbName]                     = useState('fhir-table-db');
  const [glueTablesLoading, setGlueTablesLoading]       = useState(false);

  // Source browser
  const [srcTree, setSrcTree]               = useState([]);
  const [srcExpanded, setSrcExpanded]       = useState(new Set());
  const [srcSelectedPath, setSrcSelectedPath] = useState('');
  const [srcContent, setSrcContent]         = useState('');
  const [srcLoading, setSrcLoading]         = useState(false);
  const [srcError, setSrcError]             = useState('');
  const [srcTreeLoaded, setSrcTreeLoaded]   = useState(false);
  const [srcQuickFile, setSrcQuickFile]     = useState('aws-cli-deploy.md');
  const [srcFullscreen, setSrcFullscreen]   = useState(false);
  const [showApiModal, setShowApiModal]     = useState(false);
  const [showDocsModal, setShowDocsModal]   = useState(false);
  const [showGlueModal, setShowGlueModal]     = useState(false);
  const [showClaimsModal, setShowClaimsModal] = useState(false);
  const [showClaimsViewModal, setShowClaimsViewModal] = useState(false);
  const [showClaimsPipelineModal, setShowClaimsPipelineModal] = useState(false);
  const [showSQSModal, setShowSQSModal]       = useState(false);
  const [showAthenaModal, setShowAthenaModal] = useState(false);
  const [quickGenerating, setQuickGenerating] = useState(false);
  const [quickGenToast, setQuickGenToast]     = useState(null);
  const [quickCleaning, setQuickCleaning]     = useState(false);
  const [quickCleanToast, setQuickCleanToast] = useState(null);
  const [docsMode, setDocsMode]             = useState('deploy');

  const selected = useMemo(
    () => API_OPTIONS.find((o) => o.id === selectedId) || API_OPTIONS[0],
    [selectedId],
  );

  const dynamoTableRows = useMemo(() => chunkTableNames(dynamoTables, 5), [dynamoTables]);
  const normalizedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);
  const backendModeLabel  = useMemo(() => getBackendModeLabel(backendMode), [backendMode]);
  // After login: lock buttons to the mode used at login; cmdline unlocks all
  const modeLocked = loginMode !== null && loginMode !== 'cmdline';

  // Auth helpers (Flask uses JWT in localStorage)
  function getAuthToken() { return authToken; }

  async function handleQuickGenerate() {
    setQuickGenerating(true);
    setQuickGenToast(null);
    try {
      const res = await fetch(`${normalizedBaseUrl}/claims/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const rows = data.rows_written ?? data.rows ?? '?';
      const missing = data.rows_missing_date ?? '?';
      const file = (data.key || data.s3_key || 'claims').split('/').pop();
      setQuickGenToast({ ok: true, msg: `✅ ${file} · ${rows} rows generated · ${missing} missing service_date` });
    } catch (err) {
      setQuickGenToast({ ok: false, msg: `❌ ${err.message}` });
    } finally {
      setQuickGenerating(false);
      setTimeout(() => setQuickGenToast(null), 7000);
    }
  }

  async function handleQuickClean() {
    setQuickCleaning(true);
    setQuickCleanToast(null);
    try {
      const res = await fetch(`${normalizedBaseUrl}/claims/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const qr = data.quality_report || {};
      const file = (data.parquet_key || data.key || '').split('/').pop() || 'parquet';
      setQuickCleanToast({ ok: true, msg: `✅ ${file} · ${qr.clean_rows ?? '?'} clean rows → Glue registered` });
    } catch (err) {
      setQuickCleanToast({ ok: false, msg: `❌ ${err.message}` });
    } finally {
      setQuickCleaning(false);
      setTimeout(() => setQuickCleanToast(null), 7000);
    }
  }

  function authHeaders(extra = {}) {
    return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginStatus('Logging in...');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.accessToken || data.token)) {
        const tok = data.accessToken || data.token;
        localStorage.setItem('healthCareToken', tok);
        setAuthToken(tok);
        setLoginMode(backendMode);
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
    localStorage.removeItem('healthCareToken');
    localStorage.removeItem('healthCareSSOMode');
    setAuthToken('');
    setLoginMode(null);
    setLoginStatus('Logged out');
    window.location.href = LANDING_URL;
  }

  // Auto-populate body template when endpoint changes
  useEffect(() => {
    if (['exportS3', 'registerGlue', 'uploadJson', 'postMedication', 'putMedication', 'pipelineAll', 'pipelineFromCsv'].includes(selectedId)) {
      setBodyText(prettyJson(defaultBodyFor(selectedId)));
    }
  }, [selectedId]);

  // ESC closes fullscreen file viewer and returns to main page
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && srcFullscreen) {
        setSrcFullscreen(false);
        setSrcContent('');
        setSrcSelectedPath('');
        setShowDocsModal(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [srcFullscreen]);

  // Backend preset switcher
  function setBackendTarget(mode) {
    const nextUrl = BACKEND_PRESETS[mode] || baseUrl;
    setBackendMode(mode);
    setBaseUrl(nextUrl);
  }
  function handleBaseUrlChange(event) {
    const next = event.target.value;
    setBaseUrl(next);
    setBackendMode(resolveBackendMode(next));
  }

  // Load table list
  async function loadDynamoTables(currentBaseUrl) {
    try {
      const base = normalizeBaseUrl(currentBaseUrl || baseUrl);
      const res = await fetch(`${base}/tables`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setDynamoTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch { /* silent */ }
  }

  // Load Glue Data Lake tables
  async function loadGlueTables(db) {
    const database = (db || glueDbName || 'fhir-table-db').trim();
    if (!database) return;
    setGlueTablesLoading(true);
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/glue/databases/${encodeURIComponent(database)}/tables`,
        { headers: authHeaders() },
      );
      if (!res.ok) { setGlueTables([]); return; }
      const data = await res.json();
      setGlueTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch { /* silent */ }
    finally { setGlueTablesLoading(false); }
  }

  // Load medications for dropdowns
  async function loadOptions(currentBaseUrl) {
    try {
      const base = normalizeBaseUrl(currentBaseUrl);
      const res = await fetch(`${base}/medications/?limit=250`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

      const medChoices = items.filter((i) => i && i.id).map((i) => ({
        value: String(i.id),
        label: `${i.id} — ${i.description || i.code || 'Unnamed'}`,
      }));
      const ptChoices = [...new Set(items.map((i) => i && i.patient).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const codeChoices = [...new Set(items.map((i) => i && i.code).filter(Boolean))].sort((a, b) => a.localeCompare(b));

      setMedicationOptions(medChoices);
      setPatientOptions(ptChoices);
      setCodeOptions(codeChoices);

      if (medChoices.length === 0) { setMedicationId(''); setMedicationPathId(''); }
      else if (!medChoices.some((o) => o.value === medicationId)) { setMedicationId(medChoices[0].value); setMedicationPathId(medChoices[0].value); }
      else if (!medChoices.some((o) => o.value === medicationPathId)) { setMedicationPathId(medChoices[0].value); }

      if (ptChoices.length === 0) setPatient('');
      else if (!ptChoices.includes(patient)) setPatient(ptChoices[0]);

      if (codeChoices.length === 0) setCode('');
      else if (!codeChoices.includes(code)) setCode(codeChoices[0]);
    } catch { /* silent */ }
  }

  useEffect(() => { loadOptions(baseUrl); loadDynamoTables(baseUrl); loadGlueTables(); }, [baseUrl]);

  // Computed URL path
  const resolvedPath = useMemo(() => {
    if (selected.needsId)              return selected.path.replace('{id}',           encodeURIComponent(medicationId.trim()));
    if (selected.needsPatient)         return selected.path.replace('{patient}',      encodeURIComponent(patient.trim()));
    if (selected.needsCode)            return selected.path.replace('{code}',         encodeURIComponent(code.trim()));
    if (selected.needsMedicationPathId) return selected.path.replace('{medicationId}', encodeURIComponent(medicationPathId.trim()));
    if (selected.needsDatabase)        return selected.path.replace('{database}',     encodeURIComponent(databaseName.trim()));
    return selected.path;
  }, [selected, medicationId, patient, code, medicationPathId, databaseName]);

  const requestQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (selected.needsTopN && topN.trim()) params.set('topN', topN.trim());
    if (selected.supportsQueryFilters) {
      if (queryId.trim())            params.set('id',           queryId.trim());
      if (queryPatientId.trim())     params.set('patientId',    queryPatientId.trim());
      if (queryMedicationId.trim())  params.set('medicationId', queryMedicationId.trim());
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [selected, topN, queryId, queryPatientId, queryMedicationId]);

  const resolvedUrlPreview = useMemo(
    () => `${normalizedBaseUrl}${resolvedPath}${requestQueryString}`,
    [normalizedBaseUrl, resolvedPath, requestQueryString],
  );

  // File selection
  function handleFileSelection(event) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setSelectedFileName(file ? file.name : '');
    if (file && !uploadTableName.trim()) setUploadTableName(inferTableNameFromFileName(file.name));
  }

  // Multipart upload to Flask /upload/file
  async function uploadCsvToTable() {
    const base = normalizeBaseUrl(baseUrl);
    const resolvedTable = uploadTableName.trim() || inferTableNameFromFileName(selectedFileName);

    if (!selectedFile && !resolvedTable) {
      setStatus('Select a CSV file first.');
      return;
    }

    setIsLoading(true);
    setStatus('Preparing upload...');
    setResult('');

    try {
      const sizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(1) : 0;
      if (selectedFile) setStatus(`Reading ${selectedFile.name} (${sizeMb} MB)...`);

      const formData = new FormData();
      formData.append('tableName', resolvedTable);
      if (selectedFile) formData.append('csvFile', selectedFile);

      setStatus('Uploading to DynamoDB via Flask… this can take several minutes for large files.');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20 * 60 * 1000);

      // POST multipart to Flask /upload/file — DO NOT set Content-Type; browser sets boundary
      let res = await fetch(`${base}/upload/file`, {
        method: 'POST',
        headers: authHeaders(),       // no Content-Type override — browser handles multipart
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let text = await res.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* raw text */ }

      if (res.status === 409 && parsed?.requiresConfirmation) {
        const ok = window.confirm(
          `${parsed.message}\n\nClick OK to delete the existing table and upload fresh data.\nClick Cancel to abort.`,
        );
        if (!ok) { setStatus('Upload cancelled.'); setResult(''); setIsLoading(false); return; }

        formData.append('replaceExistingTable', 'true');
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 20 * 60 * 1000);
        res = await fetch(`${base}/upload/file`, {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
          signal: c2.signal,
        });
        clearTimeout(t2);
        text = await res.text();
        parsed = text;
        try { parsed = JSON.parse(text); } catch { /* raw text */ }
      }

      setStatus(`${res.status} ${res.statusText}`);
      setResult(prettyJson(parsed));
      if (res.ok) await loadDynamoTables(baseUrl);
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus('Upload timed out (>20 min). Backend may still be processing.');
        setResult('Check backend logs and refresh the table list.');
      } else {
        setStatus('Upload failed');
        setResult(err.message || String(err));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function closeLoaderModal() { setShowLoaderModal(false); setSelectedId('getAll'); }

  // S3 bucket browser helpers
  async function openBucketBrowser(bucket) {
    setBrowserBucket(bucket);
    setBrowserPrefix('');
    setBucketObjects([]);
    setBucketObjectsError('');
    setShowBucketBrowser(true);
    await loadBucketObjects(bucket, '');
  }

  async function loadBucketObjects(bucket, prefix) {
    setBucketObjectsLoading(true);
    setBucketObjectsError('');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      const res = await fetch(`${base}/export/s3/${encodeURIComponent(bucket)}/objects${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBucketObjects(data.objects || []);
      } else {
        setBucketObjectsError(data.message || `Error ${res.status}`);
      }
    } catch (err) {
      setBucketObjectsError(err.message || String(err));
    } finally {
      setBucketObjectsLoading(false);
    }
  }

  async function downloadObject(bucket, key) {
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/s3/${encodeURIComponent(bucket)}/download?key=${encodeURIComponent(key)}`,
        { headers: authHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        // Open presigned URL in new tab — browser will download the file
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(data.message || 'Could not generate download link.');
      }
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  async function handleDeleteBucket(bucket) {
    const confirmed = window.confirm(
      `Delete bucket "${bucket}"?\n\nChoose OK to also EMPTY and delete the bucket.\nChoose Cancel to abort.`,
    );
    if (!confirmed) return;
    setDeletingBucket(true);
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/s3/${encodeURIComponent(bucket)}?force=true`,
        { method: 'DELETE', headers: authHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowBucketBrowser(false);
        // Refresh bucket list
        const res2 = await fetch(`${base}/export/s3/buckets`, { headers: authHeaders() });
        const data2 = await res2.json().catch(() => ({}));
        setBucketList(Array.isArray(data2.buckets) ? data2.buckets : []);
        alert(`Bucket "${bucket}" deleted successfully.`);
      } else {
        alert(data.message || `Delete failed (${res.status})`);
      }
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setDeletingBucket(false);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
  }

  // Main form submit
  async function runRequest(event) {
    event.preventDefault();

    // uploadFile opens the dedicated multipart upload modal
    if (selected.id === 'uploadFile') {
      setShowLoaderModal(true);
      setStatus('Opened CSV → DynamoDB uploader.');
      return;
    }

    // pipelineAll / pipelineFromCsv open the streaming pipeline modal
    if (selected.id === 'pipelineAll' || selected.id === 'pipelineFromCsv') {
      let body;
      try { body = JSON.parse(bodyText); } catch { setStatus('Invalid JSON body.'); return; }
      setPipelineEvents([]);
      setPipelineRunning(true);
      setShowPipelineModal(true);
      setStatus('Pipeline running...');
      const base = normalizeBaseUrl(baseUrl);
      const pipelinePath = selected.id === 'pipelineFromCsv' ? '/export/pipeline/from-csv' : '/export/pipeline/all';
      fetch(`${base}${pipelinePath}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }).then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              setPipelineEvents((prev) => [...prev, evt]);
            } catch { /* skip malformed line */ }
          }
        }
      }).catch((err) => {
        setPipelineEvents((prev) => [...prev, { event: 'error', message: err.message }]);
      }).finally(() => {
        setPipelineRunning(false);
        setStatus('Pipeline complete.');
        loadGlueTables();
      });
      return;
    }

    // Validation
    if (selected.needsId && !medicationId.trim())                { setStatus('Medication ID is required.'); return; }
    if (selected.needsPatient && !patient.trim())                 { setStatus('Patient is required.'); return; }
    if (selected.needsCode && !code.trim())                       { setStatus('Code is required.'); return; }
    if (selected.needsMedicationPathId && !medicationPathId.trim()) { setStatus('Medication ID is required.'); return; }
    if (selected.needsDatabase && !databaseName.trim())           { setStatus('Database name is required.'); return; }
    if (selected.needsTopN && topN.trim() && (!Number.isFinite(Number(topN)) || Number(topN) <= 0)) {
      setStatus('topN must be a positive number.'); return;
    }

    const base = normalizeBaseUrl(baseUrl);
    const url  = base + resolvedPath + requestQueryString;
    const opts = { method: selected.method, headers: authHeaders() };

    if (selected.needsFileUpload) {
      // uploadMedCsv: read file as text → send JSON with csvContent
      const payload = {};
      if (uploadTableName.trim()) payload.tableName = uploadTableName.trim();
      if (selectedFile) {
        try {
          payload.csvContent = await selectedFile.text();
          payload.fileName = selectedFile.name;
        } catch { setStatus('Unable to read selected CSV file.'); return; }
      }
      opts.headers = authHeaders({ 'Content-Type': 'application/json' });
      opts.body = JSON.stringify(payload);
    } else if (selected.needsBody) {
      try {
        const parsed = JSON.parse(bodyText);
        opts.headers = authHeaders({ 'Content-Type': 'application/json' });
        opts.body = JSON.stringify(parsed);
      } catch { setStatus('Invalid JSON body. Fix it and try again.'); return; }
    }

    setIsLoading(true);
    setStatus('Sending request...');

    try {
      let res = await fetch(url, opts);
      let text = await res.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* raw */ }

      // Handle 409 table-exists for uploadMedCsv
      if (selected.needsFileUpload && res.status === 409 && parsed?.requiresConfirmation) {
        const ok = window.confirm(
          `${parsed.message}\n\nClick OK to replace the table. Click Cancel to abort.`,
        );
        if (ok) {
          const body2 = opts.body ? JSON.parse(opts.body) : {};
          body2.replaceExistingTable = true;
          res = await fetch(url, {
            method: selected.method,
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body2),
          });
          text = await res.text();
          parsed = text;
          try { parsed = JSON.parse(text); } catch { /* raw */ }
        } else {
          setStatus('Upload cancelled — existing table was not modified.');
          setResult('');
          setIsLoading(false);
          return;
        }
      }

      setStatus(`${res.status} ${res.statusText}`);
      setResult(prettyJson(parsed));

      const rows = normalizeRowsFromResponse(parsed);
      if (rows.length > 0) {
        setTableColumns(inferTableColumns(rows));
        setTableRows(rows);
        // listBuckets gets its own browser modal
        if (selected.id === 'listBuckets' && Array.isArray(parsed.buckets)) {
          setBucketList(parsed.buckets);
          setSelectedBucket('');
          setShowBucketListModal(true);
        } else {
          setShowResponseModal(true);
        }
      } else {
        setTableRows([]);
      }

      if (['POST', 'PUT', 'DELETE'].includes(selected.method) || selected.id === 'uploadMedCsv') {
        loadOptions(baseUrl);
      }
      if ((selected.id === 'uploadMedCsv' || selected.id === 'uploadJson') && res.status === 200) {
        await loadDynamoTables(baseUrl);
      }
    } catch (err) {
      setStatus('Request failed');
      setResult(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  }

  function restartExplorer() {
    setBackendTarget('cmdline');
    setSelectedId('getAll');
    setMedicationId(medicationOptions[0]?.value || '');
    setMedicationPathId(medicationOptions[0]?.value || '');
    setPatient(patientOptions[0] || '');
    setCode(codeOptions[0] || '');
    setDatabaseName('');
    setTopN('10');
    setQueryId(''); setQueryPatientId(''); setQueryMedicationId('');
    setUploadTableName(''); setSelectedFile(null); setSelectedFileName('');
    setBodyText(prettyJson(DEFAULT_BODY));
    setResult('Run a request to see results here.');
    setStatus('Explorer reset');
  }

  // -------------------------------------------------------------------------
  // Source browser helpers
  // -------------------------------------------------------------------------
  async function loadSourceTree() {
    setSrcLoading(true);
    setSrcError('');
    try {
      const res = await fetch(`${normalizedBaseUrl}/source/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSrcTree(data.tree || []);
      setSrcTreeLoaded(true);
    } catch (e) {
      setSrcError(e.message);
    } finally {
      setSrcLoading(false);
    }
  }

  const TERRAFORM_FILES = [
    { path: 'infra/terraform/flask-fargate-ecs/main.tf',         label: 'main.tf — ECR · ECS · ALB · IAM · OIDC' },
    { path: 'infra/terraform/flask-fargate-ecs/variables.tf',    label: 'variables.tf' },
    { path: 'infra/terraform/flask-fargate-ecs/terraform.tfvars',label: 'terraform.tfvars' },
    { path: 'infra/terraform/flask-fargate-ecs/outputs.tf',      label: 'outputs.tf' },
  ];
  const DOCKER_FILES = [
    { path: 'Dockerfile',              label: 'Dockerfile — container build' },
    { path: 'docker-compose.flask.yml',label: 'docker-compose.flask.yml — local stack' },
  ];
  const YAML_FILES = [
    { path: '.github/workflows/flask-dynamo-db-backend.yml', label: 'flask-dynamo-db-backend.yml — CI/CD pipeline' },
  ];
  const LAMBDA_FILES = [
    { path: 'lambdas/synthetic_fhir_claims.py', label: 'synthetic_fhir_claims.py — generates synthetic FHIR claims CSV' },
    { path: 'lambdas/claims_cleaner.py',        label: 'claims_cleaner.py — clean CSV + register in Glue catalog' },
  ];

  function switchDocsMode(mode) {
    setDocsMode(mode);
    setSrcContent(''); setSrcError(''); setSrcSelectedPath('');
    if (mode === 'deploy')     loadSourceFile('aws-cli-deploy.md');
    else if (mode === 'readme')     loadSourceFile('README.md');
    else if (mode === 'terraform') loadSourceFile(TERRAFORM_FILES[0].path);
    else if (mode === 'docker')    loadSourceFile(DOCKER_FILES[0].path);
    else if (mode === 'yaml')      loadSourceFile(YAML_FILES[0].path);
    else if (mode === 'lambdas')      loadSourceFile(LAMBDA_FILES[0].path);
    else if (mode === 'permissions') loadSourceFile('aws-permissions.md');
    else if (mode === 'browse')      { setSrcTree([]); setSrcTreeLoaded(false); loadSourceTree(); }
  }

  async function loadSourceFile(path) {
    setSrcSelectedPath(path);
    setSrcLoading(true);
    setSrcContent('');
    setSrcError('');
    try {
      const res = await fetch(`${normalizedBaseUrl}/source/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSrcContent(data.content || '');
    } catch (e) {
      setSrcError(e.message);
    } finally {
      setSrcLoading(false);
    }
  }

  function toggleSrcDir(path) {
    setSrcExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function renderSrcTree(nodes, depth = 0) {
    return nodes.map(node => (
      <div key={node.path} style={{ paddingLeft: `${depth * 14}px` }}>
        {node.type === 'dir' ? (
          <>
            <div onClick={() => toggleSrcDir(node.path)}
              style={{ cursor: 'pointer', userSelect: 'none', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '4px' }}
              className="src-tree-dir">
              <span style={{ fontSize: '10px', color: '#64748b' }}>{srcExpanded.has(node.path) ? '▼' : '▶'}</span>
              <span>📁 {node.name}</span>
            </div>
            {srcExpanded.has(node.path) && renderSrcTree(node.children || [], depth + 1)}
          </>
        ) : (
          <div onClick={() => loadSourceFile(node.path)}
            style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: '4px',
              color: srcSelectedPath === node.path ? '#0f766e' : '#334155',
              fontWeight: srcSelectedPath === node.path ? 700 : 400,
              background: srcSelectedPath === node.path ? '#f0fdf4' : 'transparent' }}
            className="src-tree-file">
            📄 {node.name}
          </div>
        )}
      </div>
    ));
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Full-screen login gate — shown when no JWT token is present
  if (!authToken) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          padding: '40px 48px', width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🏥</div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>
              Flask FHIR Demo
            </h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              {IS_FARGATE ? 'AWS Fargate' : 'localhost:4001'} — sign in to continue
            </p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
              Email
              <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                autoComplete="username" required
                style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #475569',
                  background: '#0f172a', color: '#f1f5f9', fontSize: '14px', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
              Password
              <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                autoComplete="current-password" required
                style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #475569',
                  background: '#0f172a', color: '#f1f5f9', fontSize: '14px', outline: 'none' }} />
            </label>
            {loginStatus && (
              <div style={{ fontSize: '13px', color: loginStatus.startsWith('Logged') ? '#34d399' : '#f87171',
                background: loginStatus.startsWith('Logged') ? '#064e3b22' : '#7f1d1d22',
                border: `1px solid ${loginStatus.startsWith('Logged') ? '#059669' : '#b91c1c'}`,
                borderRadius: '6px', padding: '8px 12px' }}>
                {loginStatus}
              </div>
            )}
            <button type="submit" disabled={loginLoading}
              style={{ marginTop: '4px', padding: '11px', borderRadius: '6px', border: 'none',
                background: loginLoading ? '#374151' : 'linear-gradient(135deg,#0f766e,#065f46)',
                color: '#fff', fontWeight: 700, fontSize: '15px',
                cursor: loginLoading ? 'not-allowed' : 'pointer' }}>
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <a href={LANDING_URL}
               style={{ fontSize: '13px', color: '#60a5fa', textDecoration: 'none' }}>
              ← Back to Landing Page
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      {/* Hero */}
      <section className="hero panel">
        <div>
          <p className="eyebrow">Flask DynamoDB</p>
          <h1>ReactJs Test-Client for Flask APIs</h1>
          <p className="lede">
            Drive the Flask medication routes, generic CSV uploader, S3 export and Glue registration
            from a single React UI. All requests include the JWT stored in{' '}
            <code>localStorage.healthCareToken</code>.
          </p>
          <div className="hero-status" aria-live="polite">
            <span className={isLoading ? 'status-dot busy' : 'status-dot'} />
            <span>{isLoading ? 'Request in progress...' : 'Ready'}</span>
          </div>
          {/* ── Backend selector ── */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f766e', marginBottom: '8px' }}>Connect to backend</div>
            <div className="backend-group" role="group" aria-label="Backend target">
              <button type="button" className={backendMode === 'cmdline' ? 'backend-option active' : 'backend-option'} onClick={() => setBackendTarget('cmdline')} disabled={modeLocked ? loginMode !== 'cmdline' : IS_FARGATE} title={!modeLocked && IS_FARGATE ? 'Local computer only' : undefined}>
                Command Line
              </button>
              <button type="button" className={backendMode === 'docker' ? 'backend-option active' : 'backend-option'} onClick={() => setBackendTarget('docker')} disabled={modeLocked ? loginMode !== 'docker' : IS_FARGATE} title={!modeLocked && IS_FARGATE ? 'Local computer only' : undefined}>
                Docker
              </button>
              <button type="button" className={backendMode === 'aws' ? 'backend-option active' : 'backend-option'} onClick={() => { if (!modeLocked || loginMode === 'aws') setBackendTarget('aws'); }} disabled={modeLocked && loginMode !== 'aws'}>
                AWS Fargate{IS_FARGATE ? ' ✓' : ''}
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px' }}>
              {backendMode === 'aws'
                ? <>AWS Fargate &mdash; <code style={{fontSize:'11px'}}>{BACKEND_PRESETS.aws.replace(/^https?:\/\//, '')}</code></>
                : <>localhost:4001 &mdash; {backendMode === 'docker' ? 'docker compose up' : 'python app.py'}</>}
            </div>
          </div>

          <div style={{ marginTop: '10px', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button"
              onClick={() => setShowApiModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f766e,#065f46)', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🔬 API Explorer
            </button>
            <SwaggerDocsButton normalizedBaseUrl={normalizedBaseUrl} />
            <button type="button"
              onClick={() => { setShowDocsModal(true); setDocsMode('deploy'); loadSourceFile('aws-cli-deploy.md'); }}
              style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📖 Documentation & Source Files
            </button>
            <button type="button"
              onClick={() => setShowGlueModal(true)}
              style={{ background: 'linear-gradient(135deg,#d97706,#b45309)', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄️ Load Glue Catalog
            </button>
            <button type="button"
              onClick={() => setShowClaimsViewModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f766e,#0e7490)', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🏥 synthetic_fhir_claims_lambda
            </button>
            <button type="button"
              onClick={() => setShowClaimsModal(true)}
              style={{ background: 'linear-gradient(135deg,#065f46,#047857)', color: '#6ee7b7', border: '1px solid #059669',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄️ claims_clean_&amp;_glue_catalog_lambda
            </button>
            <button type="button"
              onClick={() => setShowClaimsPipelineModal(true)}
              style={{ background: 'linear-gradient(135deg,#4c1d95,#7c3aed)', color: '#ddd6fe', border: '1px solid #8b5cf6',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📈 claims_pipeline_session
            </button>
            <button type="button"
              onClick={() => setShowSQSModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f4c81,#1a73e8)', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📬 SQS Monitor
            </button>
            <button type="button"
              onClick={() => setShowAthenaModal(true)}
              style={{ background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#7dd3fc', border: '1px solid #2563eb',
                borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄 Athena Client
            </button>
          </div>
        </div>
        <div className="hero-badge">
          <span>Backend</span>
          <strong>{backendModeLabel}</strong>
          <span className="hero-badge-url">{normalizedBaseUrl || 'localhost'}</span>
        </div>
      </section>

      {/* Login Panel */}
      <section className="panel">
        <h2>Login</h2>
        {authToken ? (
          <div className="form">
            <div className="meta" style={{ color: '#059669', fontWeight: 700 }}>
              ✅ Authenticated — JWT token active
            </div>
            {loginStatus && <div className="meta">{loginStatus}</div>}
            <button type="button" onClick={handleLogout} style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)' }}>
              Log Out
            </button>
            <button type="button" onClick={() => window.location.href = LANDING_URL} style={{ background: 'linear-gradient(135deg,#1d4ed8,#1e3a8a)' }}>
              🏠 Landing Page
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="form">
            <div className="meta" style={{ color: '#b45309', fontWeight: 600 }}>
              No token — log in to make authenticated requests.
            </div>
            <label>
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {loginStatus && <div className="meta" style={{ color: '#b91c1c' }}>{loginStatus}</div>}
            <button type="submit" disabled={loginLoading}>
              {loginLoading ? 'Logging in...' : 'Log In'}
            </button>
          </form>
        )}
      </section>

      {/* API Explorer Modal */}
      <ApiExplorerModal
        show={showApiModal} onClose={() => setShowApiModal(false)}
        authToken={authToken} handleLogout={handleLogout}
        loginEmail={loginEmail} setLoginEmail={setLoginEmail}
        loginPassword={loginPassword} setLoginPassword={setLoginPassword}
        loginLoading={loginLoading} loginStatus={loginStatus} handleLogin={handleLogin}
        baseUrl={baseUrl} handleBaseUrlChange={handleBaseUrlChange}
        selectedId={selectedId} setSelectedId={setSelectedId} selected={selected} API_OPTIONS={API_OPTIONS}
        medicationId={medicationId} setMedicationId={setMedicationId}
        medicationPathId={medicationPathId} setMedicationPathId={setMedicationPathId}
        patient={patient} setPatient={setPatient}
        code={code} setCode={setCode}
        databaseName={databaseName} setDatabaseName={setDatabaseName}
        topN={topN} setTopN={setTopN}
        queryId={queryId} setQueryId={setQueryId}
        queryPatientId={queryPatientId} setQueryPatientId={setQueryPatientId}
        queryMedicationId={queryMedicationId} setQueryMedicationId={setQueryMedicationId}
        uploadTableName={uploadTableName} setUploadTableName={setUploadTableName}
        selectedFileName={selectedFileName} handleFileSelection={handleFileSelection}
        bodyText={bodyText} setBodyText={setBodyText}
        resolvedUrlPreview={resolvedUrlPreview}
        runRequest={runRequest} restartExplorer={restartExplorer} loadDynamoTables={loadDynamoTables}
        isLoading={isLoading} status={status} result={result}
      />

      {/* Loaded Tables */}
      <section className="panel loaded-tables-panel">
        <h2>Loaded Tables</h2>
        <div className="meta">DynamoDB tables on the current backend. Refresh after uploads or switching backends.</div>
        {dynamoTables.length === 0 ? (
          <div className="meta" style={{ marginTop: '12px' }}>No tables loaded yet.</div>
        ) : (
          <div className="dynamo-table-grid" aria-label="DynamoDB table names" style={{ marginTop: '12px' }}>
            {dynamoTableRows.map((row, ri) => (
              <div className="dynamo-table-row" key={`row-${ri}`}>
                {row.map((t) => <span className="dynamo-table-name" key={t}>{t}</span>)}
              </div>
            ))}
          </div>
        )}
        <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => loadDynamoTables(baseUrl)}>
          Refresh Table List
        </button>
      </section>

      {/* CSV → DynamoDB Uploader modal (multipart /upload/file) */}
      {showLoaderModal && (
        <div className="modal-backdrop" onClick={closeLoaderModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>CSV → DynamoDB Uploader</h3>
              <button type="button" onClick={closeLoaderModal}>Close</button>
            </div>
            <div className="meta" style={{ marginTop: '8px' }}>
              Sends <code>multipart/form-data</code> to <strong>POST /upload/file</strong> — any DynamoDB table, any CSV file.
              The Flask backend creates the table automatically if it does not exist.
            </div>

            <div className="form" style={{ marginTop: '0.75rem' }}>
              <label>
                DynamoDB Table Name
                <input
                  value={uploadTableName}
                  onChange={(e) => setUploadTableName(e.target.value)}
                  placeholder="Enter table name (auto-detected from file name)"
                />
              </label>
              <label>
                Choose CSV File
                <input type="file" accept=".csv,text/csv" onChange={handleFileSelection} />
              </label>
              <div className="meta">
                {selectedFileName
                  ? `Selected: ${selectedFileName}  (table: ${uploadTableName || inferTableNameFromFileName(selectedFileName)})`
                  : 'No file selected'}
              </div>
              {!uploadTableName.trim() && (
                <div className="meta" style={{ color: '#b45309' }}>Table name will be auto-generated from the file name.</div>
              )}
              <button type="button" disabled={isLoading} onClick={uploadCsvToTable}>
                {isLoading ? 'Uploading...' : 'Upload CSV to DynamoDB'}
              </button>

              <h3 style={{ marginTop: '1.25rem' }}>Loaded Tables</h3>
              {dynamoTables.length === 0 ? (
                <div className="meta">No tables yet. Upload a CSV or click refresh.</div>
              ) : (
                <div className="dynamo-table-grid" style={{ marginTop: '8px' }}>
                  {dynamoTableRows.map((row, ri) => (
                    <div className="dynamo-table-row" key={`mrow-${ri}`}>
                      {row.map((t) => <span className="dynamo-table-name" key={t}>{t}</span>)}
                    </div>
                  ))}
                </div>
              )}
              <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => loadDynamoTables(baseUrl)}>
                Refresh Table List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S3 Bucket List modal */}
      {showBucketListModal && (
        <div className="modal-backdrop" onClick={() => setShowBucketListModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>S3 Buckets ({bucketList.length})</h3>
              <button type="button" onClick={() => setShowBucketListModal(false)}>Close</button>
            </div>
            <div className="meta" style={{ marginTop: '8px', marginBottom: '12px' }}>
              Select a bucket then click <strong>Open</strong> to browse its contents.
            </div>
            <div className="bucket-list-wrap">
              <table className="bucket-list-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}></th>
                    <th>Bucket Name</th>
                    <th style={{ width: '110px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {bucketList.map((b) => (
                    <tr
                      key={b}
                      className={selectedBucket === b ? 'bucket-row selected' : 'bucket-row'}
                      onClick={() => setSelectedBucket(b)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="bucket-select"
                          checked={selectedBucket === b}
                          onChange={() => setSelectedBucket(b)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{b}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-open-bucket"
                          onClick={(e) => { e.stopPropagation(); setShowBucketListModal(false); openBucketBrowser(b); }}
                        >
                          Open ›
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                disabled={!selectedBucket}
                onClick={() => { setShowBucketListModal(false); openBucketBrowser(selectedBucket); }}
              >
                Open Selected Bucket
              </button>
              <button
                type="button"
                style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)' }}
                disabled={!selectedBucket}
                onClick={() => { handleDeleteBucket(selectedBucket); }}
              >
                Delete Bucket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S3 Bucket Browser modal */}
      {showBucketBrowser && (
        <div className="modal-backdrop" onClick={() => setShowBucketBrowser(false)}>
          <div className="modal-card bucket-browser-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <span style={{ color: '#64748b', fontWeight: 400 }}>s3://</span>{browserBucket}
              </h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)', fontSize: '12px', padding: '4px 12px' }}
                  disabled={deletingBucket}
                  onClick={() => handleDeleteBucket(browserBucket)}
                >
                  {deletingBucket ? 'Deleting...' : 'Delete Bucket'}
                </button>
                <button
                  type="button"
                  style={{ fontSize: '12px', padding: '4px 12px' }}
                  onClick={() => { setShowBucketBrowser(false); setShowBucketListModal(true); }}
                >
                  ‹ Back to List
                </button>
                <button type="button" onClick={() => setShowBucketBrowser(false)}>Close</button>
              </div>
            </div>

            {/* Prefix filter */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
              <input
                style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }}
                value={browserPrefix}
                onChange={(e) => setBrowserPrefix(e.target.value)}
                placeholder="Filter by prefix  (e.g. dynamodb-exports/)"
              />
              <button
                type="button"
                style={{ whiteSpace: 'nowrap', fontSize: '13px', padding: '6px 14px' }}
                onClick={() => loadBucketObjects(browserBucket, browserPrefix)}
              >
                Refresh
              </button>
            </div>

            {bucketObjectsError && (
              <div className="meta" style={{ color: '#b91c1c', marginTop: '8px' }}>{bucketObjectsError}</div>
            )}
            {bucketObjectsLoading ? (
              <div className="progress-wrap" style={{ marginTop: '16px' }}><div className="progress-bar" /></div>
            ) : (
              <div className="modal-table-wrap" style={{ marginTop: '12px' }}>
                {bucketObjects.length === 0 ? (
                  <div className="meta">No objects found{browserPrefix ? ` with prefix "${browserPrefix}"` : ''}.</div>
                ) : (
                  <table className="bucket-objects-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th style={{ width: '90px' }}>Size</th>
                        <th style={{ width: '190px' }}>Last Modified</th>
                        <th style={{ width: '100px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucketObjects.map((obj) => (
                        <tr key={obj.key}>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{obj.key}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}>
                            {formatBytes(obj.size)}
                          </td>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                            {obj.lastModified ? new Date(obj.lastModified).toLocaleString() : '-'}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-download"
                              onClick={() => downloadObject(browserBucket, obj.key)}
                            >
                              ⬇ Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {bucketObjects.length > 0 && (
                  <div className="meta" style={{ marginTop: '8px' }}>
                    {bucketObjects.length} object{bucketObjects.length !== 1 ? 's' : ''}
                    {' · '}
                    {formatBytes(bucketObjects.reduce((s, o) => s + o.size, 0))} total
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Docs & Source Modal */}
      <DocsSourceModal
        show={showDocsModal} onClose={() => setShowDocsModal(false)}
        docsMode={docsMode} switchDocsMode={switchDocsMode}
        srcError={srcError} srcContent={srcContent} srcSelectedPath={srcSelectedPath}
        srcLoading={srcLoading} srcTree={srcTree}
        renderSrcTree={renderSrcTree} setSrcFullscreen={setSrcFullscreen}
        loadSourceFile={loadSourceFile}
        TERRAFORM_FILES={TERRAFORM_FILES} DOCKER_FILES={DOCKER_FILES} YAML_FILES={YAML_FILES} LAMBDA_FILES={LAMBDA_FILES}
      />

      {/* Glue Catalog Uploader Modal */}
      <GlueCatalogUploader
        show={showGlueModal} onClose={() => setShowGlueModal(false)}
        baseUrl={baseUrl} authToken={authToken}
        buckets={bucketList}
      />

      {/* Quick-Generate toast */}
      {quickGenToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: quickGenToast.ok ? '#052e16' : '#1f0d0d',
          border: `1px solid ${quickGenToast.ok ? '#16a34a' : '#dc2626'}`,
          color: quickGenToast.ok ? '#86efac' : '#fca5a5',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxWidth: 420 }}>
          {quickGenToast.msg}
        </div>
      )}
      {/* Quick-Clean toast */}
      {quickCleanToast && (
        <div style={{ position: 'fixed', bottom: 68, right: 24, zIndex: 9999,
          background: quickCleanToast.ok ? '#0c1a3a' : '#1f0d0d',
          border: `1px solid ${quickCleanToast.ok ? '#2563eb' : '#dc2626'}`,
          color: quickCleanToast.ok ? '#bfdbfe' : '#fca5a5',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxWidth: 420 }}>
          {quickCleanToast.msg}
        </div>
      )}

      {/* Stage 1 — Invoke lambda to generate CSV, then view staged files */}
      <ClaimsGenerator
        show={showClaimsViewModal} onClose={() => setShowClaimsViewModal(false)}
        baseUrl={baseUrl} authToken={authToken}
        catalogEnabled={false}
        generateOnOpen={true}
      />

      {/* Stage 2 — Clean & Catalog into Glue */}
      <ClaimsGenerator
        show={showClaimsModal} onClose={() => setShowClaimsModal(false)}
        baseUrl={baseUrl} authToken={authToken}
        catalogEnabled={true}
        onGenerateSuccess={() => { setShowClaimsModal(false); setShowSQSModal(true); }}
      />

      {/* SQS Lambda Monitor Modal */}
      <SQSMonitor
        show={showSQSModal} onClose={() => setShowSQSModal(false)}
        baseUrl={baseUrl} authToken={authToken}
      />

      {/* Athena SQL Client */}
      <AthenaClient
        show={showAthenaModal} onClose={() => setShowAthenaModal(false)}
        baseUrl={baseUrl} authToken={authToken}
      />

      {/* Claims pipeline session monitor */}
      <ClaimsPipelineModal
        show={showClaimsPipelineModal}
        onClose={() => setShowClaimsPipelineModal(false)}
        baseUrl={baseUrl}
        authToken={authToken}
      />

      {/* Source Browser */}
      <section className="panel">
        <h2>Source Browser</h2>
        <p style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
          Browse the full project source — Flask backend, React UI, Terraform infrastructure, Docker config, Jupyter notebooks, and GitHub Actions CI/CD pipelines.
        </p>

        {/* Lambda quick-view buttons */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', alignSelf: 'center', whiteSpace: 'nowrap' }}>Lambda Functions:</span>
          {[
            { path: 'lambdas/synthetic_fhir_claims.py', label: '🧬 synthetic_fhir_claims.py', desc: 'generates CSV' },
            { path: 'lambdas/claims_cleaner.py',        label: '🧹 claims_cleaner.py',        desc: 'clean + Glue catalog' },
          ].map(({ path, label, desc }) => (
            <button key={path} type="button"
              onClick={() => { setSrcQuickFile(path); loadSourceFile(path); }}
              style={{ background: srcQuickFile === path ? '#1e293b' : '#f0f9ff',
                color: srcQuickFile === path ? '#7dd3fc' : '#0369a1',
                border: '1px solid ' + (srcQuickFile === path ? '#334155' : '#bae6fd'),
                borderRadius: '6px', padding: '6px 14px', fontWeight: 700,
                fontSize: '13px', cursor: 'pointer', fontFamily: 'monospace' }}>
              {label} <span style={{ fontFamily: 'sans-serif', fontWeight: 400, fontSize: '12px',
                color: srcQuickFile === path ? '#94a3b8' : '#64748b' }}>({desc})</span>
            </button>
          ))}
        </div>

        {/* AWS Reference docs quick-view */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', alignSelf: 'center', whiteSpace: 'nowrap' }}>AWS Reference:</span>
          {[
            { path: 'aws-permissions.md', label: '🔐 aws-permissions.md', desc: 'IAM policies & CLI commands' },
            { path: 'aws-cli-deploy.md',   label: '🚀 aws-cli-deploy.md',   desc: 'Docker · Fargate deploy guide' },
          ].map(({ path, label, desc }) => (
            <button key={path} type="button"
              onClick={() => { setSrcQuickFile(path); loadSourceFile(path); }}
              style={{ background: srcQuickFile === path ? '#1e293b' : '#f0fdf4',
                color: srcQuickFile === path ? '#7dd3fc' : '#166534',
                border: '1px solid ' + (srcQuickFile === path ? '#334155' : '#bbf7d0'),
                borderRadius: '6px', padding: '6px 14px', fontWeight: 700,
                fontSize: '13px', cursor: 'pointer', fontFamily: 'monospace' }}>
              {label} <span style={{ fontFamily: 'sans-serif', fontWeight: 400, fontSize: '12px',
                color: srcQuickFile === path ? '#94a3b8' : '#64748b' }}>({desc})</span>
            </button>
          ))}
        </div>

        {/* Quick-access dropdown */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Quick View:</label>
          <select value={srcQuickFile} onChange={(e) => setSrcQuickFile(e.target.value)}
            style={{ flex: 1, minWidth: '220px', fontSize: '13px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}>
            <option value="">— select a key file —</option>
            <option value="aws-permissions.md">🔐 aws-permissions.md  (IAM inline policies &amp; AWS CLI commands)</option>
            <option value="aws-cli-deploy.md">🚀 aws-cli-deploy.md  (Docker · Terraform · Fargate deploy guide)</option>
            <option value="README.md">📖 README.md  (project overview, Docker &amp; AWS deploy guide)</option>
            <optgroup label="Flask App">
              <option value="app.py">app.py  (blueprints + CORS + error handlers)</option>
              <option value="Dockerfile">Dockerfile  (container build)</option>
              <option value="requirements.txt">requirements.txt</option>
              <option value="openapi.json">openapi.json  (API spec)</option>
            </optgroup>
            <optgroup label="Routes">
              <option value="routes/medications.py">routes/medications.py  (CRUD)</option>
              <option value="routes/auth.py">routes/auth.py  (JWT auth)</option>
              <option value="routes/export.py">routes/export.py  (S3 export + Glue)</option>
              <option value="routes/source.py">routes/source.py  (this source browser API)</option>
            </optgroup>
            <optgroup label="Modules">
              <option value="modules/auth.py">modules/auth.py  (user management)</option>
            </optgroup>
            <optgroup label="Lambda Functions">
              <option value="lambdas/synthetic_fhir_claims.py">lambdas/synthetic_fhir_claims.py  (generates synthetic FHIR claims CSV)</option>
              <option value="lambdas/claims_cleaner.py">lambdas/claims_cleaner.py  (cleans CSV + registers in Glue catalog)</option>
            </optgroup>
          </select>
          <button type="button" disabled={!srcQuickFile || srcLoading}
            onClick={() => srcQuickFile && loadSourceFile(srcQuickFile)}
            style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600,
              background: srcQuickFile ? '#0f766e' : '#94a3b8', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: srcQuickFile ? 'pointer' : 'default' }}>
            View
          </button>
          {!srcTreeLoaded ? (
            <button type="button" disabled={srcLoading} onClick={loadSourceTree}
              style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600,
                background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              {srcLoading && !srcContent ? 'Loading...' : 'Browse All Files'}
            </button>
          ) : (
            <button type="button" onClick={() => { setSrcTreeLoaded(false); setSrcTree([]); setSrcExpanded(new Set()); }}
              style={{ padding: '6px 14px', fontSize: '13px', color: '#475569',
                background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>
              Hide Tree
            </button>
          )}
        </div>

        {srcError && (
          <div style={{ color: '#b91c1c', fontSize: '13px', marginBottom: '10px', padding: '8px 12px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
            Error: {srcError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '16px', minHeight: srcTreeLoaded || srcContent ? '320px' : 'auto' }}>
          {/* File tree */}
          {srcTreeLoaded && (
            <div style={{ width: '250px', flexShrink: 0, overflowY: 'auto', maxHeight: '520px',
              borderRight: '1px solid #e2e8f0', paddingRight: '10px',
              fontSize: '12.5px', fontFamily: '"Fira Mono", monospace', lineHeight: '1.5' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: '#64748b', marginBottom: '8px' }}>
                /source
              </div>
              {srcTree.length > 0 ? renderSrcTree(srcTree) : (
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>No files found</div>
              )}
            </div>
          )}

          {/* File content */}
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', minHeight: '24px' }}>
              {srcSelectedPath && (
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: '#64748b', fontFamily: 'monospace',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {srcSelectedPath}
                </span>
              )}
              {srcContent && (
                <button type="button" onClick={() => setSrcFullscreen(true)}
                  style={{ padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                    background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
                    borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  ⛶ Full Screen
                </button>
              )}
            </div>
            {srcLoading && !srcContent && (
              <div style={{ color: '#64748b', fontSize: '13px', padding: '12px 0' }}>Loading file...</div>
            )}
            {srcContent ? (
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '16px', borderRadius: '8px',
                fontSize: '12px', lineHeight: '1.65', overflow: 'auto', maxHeight: '520px',
                whiteSpace: 'pre', margin: 0,
                fontFamily: '"Fira Mono", "Cascadia Code", "Consolas", monospace' }}>
                {srcContent}
              </pre>
            ) : (
              !srcLoading && (
                <div style={{ color: '#94a3b8', fontSize: '13px', paddingTop: '4px' }}>
                  Pick a file from the dropdown above or click a file in the tree.
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* Data Lake Pipeline modal */}
      {showPipelineModal && (
        <div className="modal-backdrop" onClick={() => !pipelineRunning && setShowPipelineModal(false)}>
          <div className="modal-card pipeline-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Data Lake Pipeline — All Tables → S3 + Glue</h3>
              <button type="button" disabled={pipelineRunning} onClick={() => setShowPipelineModal(false)}>
                {pipelineRunning ? 'Running...' : 'Close'}
              </button>
            </div>

            {pipelineRunning && (
              <div className="progress-wrap" style={{ marginTop: '12px' }}><div className="progress-bar" /></div>
            )}

            <div className="pipeline-event-list">
              {pipelineEvents.map((evt, i) => {
                if (evt.event === 'start') return (
                  <div key={i} className="pipeline-evt pipeline-evt-start">
                    Started — {evt.totalTables} table{evt.totalTables !== 1 ? 's' : ''} to process
                  </div>
                );
                if (evt.event === 'done') return (
                  <div key={i} className="pipeline-evt pipeline-evt-done">
                    ✅ Done in {evt.durationSeconds}s &nbsp;·&nbsp;
                    {evt.exported} exported &nbsp;·&nbsp;
                    {evt.registered} registered in Glue &nbsp;·&nbsp;
                    {evt.errors} error{evt.errors !== 1 ? 's' : ''}
                    <br/>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      Bucket: {evt.bucket} &nbsp;·&nbsp; Glue DB: {evt.glueDatabase}
                    </span>
                  </div>
                );
                if (evt.event === 'error') return (
                  <div key={i} className="pipeline-evt pipeline-evt-error">
                    ❌ {evt.message}
                  </div>
                );
                if (evt.event === 'progress') {
                  const isOk = evt.status === 'ok';
                  const icon = isOk ? (evt.step === 'export' ? '📦' : '🗂') : '❌';
                  const label = evt.step === 'export'
                    ? `${isOk ? `→ S3  (${evt.rows} rows, ${formatBytes(evt.sizeBytes)})` : `export failed: ${evt.message}`}`
                    : `${isOk ? `→ Glue "${evt.database}" [${evt.action}]` : `Glue failed: ${evt.message}`}`;
                  return (
                    <div key={i} className={`pipeline-evt pipeline-evt-progress ${isOk ? 'ok' : 'err'}`}>
                      {icon} <strong>{evt.table}</strong> {label}
                    </div>
                  );
                }
                return null;
              })}
              {pipelineRunning && pipelineEvents.length === 0 && (
                <div className="pipeline-evt" style={{ color: '#64748b' }}>Waiting for first table...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Response table modal */}
      {showResponseModal && (
        <div className="modal-backdrop" onClick={() => setShowResponseModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Response Items</h3>
              <button type="button" onClick={() => setShowResponseModal(false)}>Close</button>
            </div>
            <div className="modal-table-wrap">
              <table>
                <thead>
                  <tr>{tableColumns.map((col) => <th key={col}>{col}</th>)}</tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={`${row.id || 'row'}-${i}`}>
                      {tableColumns.map((col) => <td key={col}>{getCellValue(row, col)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* Fullscreen file viewer */}
      {srcFullscreen && srcContent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,6,23,0.97)',
          display: 'flex', flexDirection: 'column', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexShrink: 0 }}>
            <span style={{ color: '#94a3b8', fontFamily: '"Fira Mono", monospace', fontSize: '13px',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {srcSelectedPath}
            </span>
            <span style={{ color: '#475569', fontSize: '12px' }}>ESC to close</span>
            <button type="button" onClick={() => {
                setSrcFullscreen(false);
                setSrcContent('');
                setSrcSelectedPath('');
                setShowDocsModal(false);
              }}
              style={{ padding: '5px 16px', fontSize: '13px', fontWeight: 700,
                background: '#ef4444', color: '#fff', border: 'none',
                borderRadius: '6px', cursor: 'pointer' }}>
              ✕ Close
            </button>
          </div>
          <pre style={{ flex: 1, background: '#0f172a', color: '#e2e8f0', padding: '20px',
            borderRadius: '8px', fontSize: '13px', lineHeight: '1.65',
            overflow: 'auto', margin: 0, whiteSpace: 'pre',
            fontFamily: '"Fira Mono", "Cascadia Code", "Consolas", monospace' }}>
            {srcContent}
          </pre>
        </div>
      )}
    </main>
  );
}
