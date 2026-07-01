import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import ApiExplorerModal from './ApiExplorerModal';
import SwaggerDocsButton from './SwaggerDocsButton';
import DocsSourceModal from './DocsSourceModal';
import FileContentViewer from './FileContentViewer';
import GlueCatalogUploader from './GlueCatalogUploader';
import ClaimsGenerator from './ClaimsGenerator';
import SQSMonitor from './SQSMonitor';
import AthenaClient from './AthenaClient';
import PatientsEncounters from './PatientsEncounters';
import { ApiOption, MedicationOption, BucketObject, PipelineEvent, SrcTreeNode, SourceFile, ServiceUrls, Toast } from './types';

// ---------------------------------------------------------------------------
// API options
// ---------------------------------------------------------------------------
const API_OPTIONS: ApiOption[] = [
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
  { id: 'uploadFile',        label: 'POST /upload/file  (File Picker → Multipart)',         method: 'POST',   path: '/upload/file',                                     needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'uploadJson',        label: 'POST /upload  (JSON csvPath)',                         method: 'POST',   path: '/upload',                                          needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'listBuckets',       label: 'GET /export/s3/buckets',                               method: 'GET',    path: '/export/s3/buckets',                               needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'exportS3',          label: 'POST /export/s3  (DynamoDB → S3)',                     method: 'POST',   path: '/export/s3',                                       needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'listGlueDbs',       label: 'GET /export/glue/databases',                           method: 'GET',    path: '/export/glue/databases',                           needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'listGlueTables',    label: 'GET /export/glue/databases/{database}/tables',         method: 'GET',    path: '/export/glue/databases/{database}/tables',         needsBody: false, needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: true,  needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'registerGlue',      label: 'POST /export/glue  (Register S3 path in Glue)',        method: 'POST',   path: '/export/glue',                                     needsBody: true,  needsId: false,  needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'pipelineAll',     label: '🚀 POST /export/pipeline/all  (DynamoDB → S3 + Glue)',  method: 'POST', path: '/export/pipeline/all',      needsBody: true, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'pipelineFromCsv', label: '📂 POST /export/pipeline/from-csv  (CSV → S3 + Glue)',  method: 'POST', path: '/export/pipeline/from-csv', needsBody: true, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsDatabase: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
];

// ---------------------------------------------------------------------------
// Default body templates
// ---------------------------------------------------------------------------
const DEFAULT_BODY = { id: 'patient-encounter-code', start: '2022-11-07T00:00:00.000Z', stop: '2022-11-07T00:00:00.000Z', patient: 'patient-123', payer: 'payer-123', encounter: 'encounter-123', code: 'med-code-123', description: 'Medication sample', baseCost: 10.5, payerCoverage: 8.2, dispenses: 1, totalCost: 10.5, reasonCode: 'reason-1', reasonDescription: 'Demo payload' };
const DEFAULT_EXPORT_S3_BODY = { tableName: 'allergies', bucket: 'healthcare-exports-005905648819', prefix: 'dynamodb-exports/', format: 'csv' };
const DEFAULT_PIPELINE_ALL_BODY = { bucket: 'healthcare-exports-005905648819', glueDatabase: 'healthcare_data_lake', prefix: 'datalake/', format: 'csv', createBucket: false, createDatabase: true };
const DEFAULT_PIPELINE_CSV_BODY = { bucket: 'healthcare-exports-005905648819', glueDatabase: 'healthcare_data_lake', prefix: 'datalake/', csvDir: '/coherent-11-07-2022/csv', createBucket: false, createDatabase: true };
const DEFAULT_REGISTER_GLUE_BODY = { tableName: 'allergies', s3Uri: 's3://healthcare-exports-005905648819/dynamodb-exports/allergies/', database: 'healthcare', format: 'csv' };
const DEFAULT_UPLOAD_JSON_BODY = { tableName: 'medications', csvPath: 'C:/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/coherent-11-07-2022/csv/medications.csv' };

const TABLE_COLUMNS = ['id','start','stop','patient','payer','encounter','code','description','baseCost','payerCoverage','dispenses','totalCost','reasonCode','reasonDescription'];

// True when the page is served from a remote host (EC2, Fargate, any non-localhost)
const IS_FARGATE = !['localhost', '127.0.0.1'].includes(window.location.hostname);
// Single gateway entry point — auto-derives the host so no hardcoded IP is needed
const GATEWAY_ORIGIN = `${window.location.protocol}//${window.location.hostname}:8080`;

const BACKEND_PRESETS: Record<string, string> = {
  cmdline: 'http://localhost:4002',
  docker:  'http://localhost:4002',
  aws:     `${GATEWAY_ORIGIN}/proxy/django`,
};

const MICROSERVICE_URLS: ServiceUrls = IS_FARGATE ? {
  glueCatalog:        `${GATEWAY_ORIGIN}/proxy/glue`,
  claimsGenerator:    `${GATEWAY_ORIGIN}/proxy/claims`,
  claimsCleaner:      `${GATEWAY_ORIGIN}/proxy/cleaner`,
  sqsMonitor:         `${GATEWAY_ORIGIN}/proxy/sqs`,
  athenaClient:       `${GATEWAY_ORIGIN}/proxy/athena`,
  patientsEncounters: `${GATEWAY_ORIGIN}/proxy/patients`,
} : {
  glueCatalog:        'http://localhost:4010',
  claimsGenerator:    'http://localhost:4011',
  claimsCleaner:      'http://localhost:4012',
  sqsMonitor:         'http://localhost:4013',
  athenaClient:       'http://localhost:4014',
  patientsEncounters: 'http://localhost:4015',
};
const LANDING_URL = window.location.hostname === 'localhost'
  ? `${window.location.protocol}//localhost:5180`
  : `${window.location.protocol}//${window.location.hostname}`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function prettyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function normalizeBaseUrl(value: string): string {
  return String(value ?? '').trim().replace(/\/$/, '');
}

function resolveBackendMode(url: string): string {
  const n = normalizeBaseUrl(url);
  const entry = Object.entries(BACKEND_PRESETS).find(([, v]) => normalizeBaseUrl(v) === n);
  return entry ? entry[0] : 'custom';
}

function getBackendModeLabel(mode: string): string {
  if (mode === 'cmdline') return 'Command Line';
  if (mode === 'docker')  return 'Docker';
  if (mode === 'aws')     return 'AWS';
  return 'Custom';
}

function normalizeRowsFromResponse(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === 'object');
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.items))   return (p.items   as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
    if (Array.isArray(p.data))    return (p.data    as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
    if (Array.isArray(p.results)) return (p.results as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
    if (Array.isArray(p.tables))  return (p.tables  as string[]).map((t) => ({ table: t }));
    if (Array.isArray(p.buckets)) return (p.buckets as string[]).map((b) => ({ bucket: b }));
    return [p];
  }
  return [];
}

function inferTableColumns(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  rows.forEach((row) => {
    Object.keys(row ?? {}).forEach((key) => { if (!keys.includes(key)) keys.push(key); });
  });
  return keys.length === 0 ? TABLE_COLUMNS : keys;
}

function getCellValue(row: Record<string, unknown>, key: string): ComponentChildren {
  const value = row[key];
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const names = value
        .map((item) => (item as Record<string, string>).medicationName || (item as Record<string, string>).description || (item as Record<string, string>).name || (item as Record<string, string>).medicationId)
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

function inferTableNameFromFileName(fileName: string): string {
  return String(fileName ?? '').replace(/\.[^/.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'uploaded_data';
}

function chunkTableNames(names: string[], size: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < names.length; i += size) rows.push(names.slice(i, i + size));
  return rows;
}

function defaultBodyFor(id: string): unknown {
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
  const [authToken, setAuthToken]               = useState('');
  const [loginEmail, setLoginEmail]             = useState('react-dgs@yahoo.com');
  const [loginPassword, setLoginPassword]       = useState('python');
  const [loginStatus, setLoginStatus]           = useState('');
  const [loginLoading, setLoginLoading]         = useState(false);

  const [baseUrl, setBaseUrl]                   = useState(IS_FARGATE ? BACKEND_PRESETS.aws : BACKEND_PRESETS.cmdline);
  const [backendMode, setBackendMode]           = useState(IS_FARGATE ? 'aws' : 'cmdline');
  const [loginMode, setLoginMode]               = useState<string | null>(null);
  const [microservicesMode, setMicroservicesMode] = useState(true);
  const [serviceUrls, setServiceUrls]           = useState<ServiceUrls>({ ...MICROSERVICE_URLS });
  const [selectedId, setSelectedId]             = useState('getAll');
  const [medicationId, setMedicationId]         = useState('');
  const [medicationPathId, setMedicationPathId] = useState('');
  const [patientOptions, setPatientOptions]     = useState<string[]>([]);
  const [patient, setPatient]                   = useState('');
  const [codeOptions, setCodeOptions]           = useState<string[]>([]);
  const [code, setCode]                         = useState('');
  const [databaseName, setDatabaseName]         = useState('');
  const [topN, setTopN]                         = useState('10');
  const [queryId, setQueryId]                   = useState('');
  const [queryPatientId, setQueryPatientId]     = useState('');
  const [queryMedicationId, setQueryMedicationId] = useState('');
  const [uploadTableName, setUploadTableName]   = useState('');
  const [selectedFile, setSelectedFile]         = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [medicationOptions, setMedicationOptions] = useState<MedicationOption[]>([]);
  const [bodyText, setBodyText]                 = useState(prettyJson(DEFAULT_BODY));
  const [result, setResult]                     = useState('Run a request to see results here.');
  const [status, setStatus]                     = useState('');
  const [isLoading, setIsLoading]               = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showLoaderModal, setShowLoaderModal]   = useState(false);
  const [tableRows, setTableRows]               = useState<Record<string, unknown>[]>([]);
  const [tableColumns, setTableColumns]         = useState<string[]>(TABLE_COLUMNS);
  const [dynamoTables, setDynamoTables]         = useState<string[]>([]);

  const [showBucketListModal, setShowBucketListModal] = useState(false);
  const [bucketList, setBucketList]                   = useState<string[]>([]);
  const [selectedBucket, setSelectedBucket]           = useState('');
  const [showBucketBrowser, setShowBucketBrowser]     = useState(false);
  const [browserBucket, setBrowserBucket]             = useState('');
  const [bucketObjects, setBucketObjects]             = useState<BucketObject[]>([]);
  const [bucketObjectsLoading, setBucketObjectsLoading] = useState(false);
  const [bucketObjectsError, setBucketObjectsError]   = useState('');
  const [browserPrefix, setBrowserPrefix]             = useState('');
  const [deletingBucket, setDeletingBucket]           = useState(false);

  const [showPipelineModal, setShowPipelineModal]     = useState(false);
  const [pipelineEvents, setPipelineEvents]           = useState<PipelineEvent[]>([]);
  const [pipelineRunning, setPipelineRunning]         = useState(false);

  const [glueTables, setGlueTables]                   = useState<string[]>([]);
  const [glueDbName, setGlueDbName]                   = useState('fhir-table-db');
  const [glueTablesLoading, setGlueTablesLoading]     = useState(false);

  const [srcTree, setSrcTree]                   = useState<SrcTreeNode[]>([]);
  const [srcExpanded, setSrcExpanded]           = useState<Set<string>>(new Set());
  const [srcSelectedPath, setSrcSelectedPath]   = useState('');
  const [srcContent, setSrcContent]             = useState('');
  const [srcLoading, setSrcLoading]             = useState(false);
  const [srcError, setSrcError]                 = useState('');
  const [srcTreeLoaded, setSrcTreeLoaded]       = useState(false);
  const [srcQuickFile, setSrcQuickFile]         = useState('aws-cli-deploy.md');
  const [srcFullscreen, setSrcFullscreen]       = useState(false);
  const [showApiModal, setShowApiModal]         = useState(false);
  const [showDocsModal, setShowDocsModal]       = useState(false);
  const [showGlueModal, setShowGlueModal]       = useState(false);
  const [showClaimsModal, setShowClaimsModal]   = useState(false);
  const [showClaimsViewModal, setShowClaimsViewModal] = useState(false);
  const [showSQSModal, setShowSQSModal]         = useState(false);
  const [showAthenaModal, setShowAthenaModal]   = useState(false);
  const [showPatientsModal, setShowPatientsModal] = useState(false);
  const [quickGenerating, setQuickGenerating]   = useState(false);
  const [quickGenToast, setQuickGenToast]       = useState<Toast | null>(null);
  const [quickCleaning, setQuickCleaning]       = useState(false);
  const [quickCleanToast, setQuickCleanToast]   = useState<Toast | null>(null);
  const [docsMode, setDocsMode]                 = useState('deploy');

  const selected = useMemo(
    () => API_OPTIONS.find((o) => o.id === selectedId) ?? API_OPTIONS[0],
    [selectedId],
  );

  const dynamoTableRows   = useMemo(() => chunkTableNames(dynamoTables, 5), [dynamoTables]);
  const normalizedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);
  const backendModeLabel  = useMemo(() => getBackendModeLabel(backendMode), [backendMode]);
  // After login: lock buttons to the mode used at login; cmdline unlocks all
  const modeLocked = loginMode !== null && loginMode !== 'cmdline';

  function getAuthToken() { return authToken; }

  async function handleQuickGenerate() {
    setQuickGenerating(true);
    setQuickGenToast(null);
    try {
      const targetUrl = microservicesMode ? serviceUrls.claimsGenerator : normalizedBaseUrl;
      const res = await fetch(`${targetUrl}/claims/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      const rows = (data as { rows_written?: number; rows?: number }).rows_written ?? (data as { rows?: number }).rows ?? '?';
      const missing = (data as { rows_missing_date?: number }).rows_missing_date ?? '?';
      const file = ((data as { key?: string; s3_key?: string }).key ?? (data as { s3_key?: string }).s3_key ?? 'claims').split('/').pop();
      setQuickGenToast({ ok: true, msg: `✅ ${file} · ${rows} rows generated · ${missing} missing service_date` });
    } catch (err) {
      setQuickGenToast({ ok: false, msg: `❌ ${(err as Error).message}` });
    } finally {
      setQuickGenerating(false);
      setTimeout(() => setQuickGenToast(null), 7000);
    }
  }

  async function handleQuickClean() {
    setQuickCleaning(true);
    setQuickCleanToast(null);
    try {
      const targetUrl = microservicesMode ? serviceUrls.claimsCleaner : normalizedBaseUrl;
      const res = await fetch(`${targetUrl}/claims/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      const qr = (data as { quality_report?: { clean_rows?: number } }).quality_report ?? {};
      const file = ((data as { parquet_key?: string; key?: string }).parquet_key ?? (data as { key?: string }).key ?? '').split('/').pop() ?? 'parquet';
      setQuickCleanToast({ ok: true, msg: `✅ ${file} · ${qr.clean_rows ?? '?'} clean rows → Glue registered` });
    } catch (err) {
      setQuickCleanToast({ ok: false, msg: `❌ ${(err as Error).message}` });
    } finally {
      setQuickCleaning(false);
      setTimeout(() => setQuickCleanToast(null), 7000);
    }
  }

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
  }

  async function handleLogin(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
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
      const data = await res.json().catch(() => ({})) as { accessToken?: string; token?: string; user?: { email: string }; message?: string; error?: string };
      if (res.ok && (data.accessToken ?? data.token)) {
        const tok = (data.accessToken ?? data.token)!;
        localStorage.setItem('healthCareToken', tok);
        setAuthToken(tok);
        setLoginMode(backendMode);
        setLoginStatus(`Logged in as ${data.user?.email ?? loginEmail}`);
      } else {
        setLoginStatus(data.message ?? data.error ?? `Login failed (${res.status})`);
      }
    } catch (err) {
      setLoginStatus(`Error: ${(err as Error).message}`);
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('healthCareToken');
    setAuthToken('');
    setLoginMode(null);
    setLoginStatus('Logged out');
    window.location.href = LANDING_URL;
  }

  useEffect(() => {
    if (['exportS3','registerGlue','uploadJson','postMedication','putMedication','pipelineAll','pipelineFromCsv'].includes(selectedId)) {
      setBodyText(prettyJson(defaultBodyFor(selectedId)));
    }
  }, [selectedId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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

  function setBackendTarget(mode: string) {
    const nextUrl = BACKEND_PRESETS[mode] ?? baseUrl;
    setBackendMode(mode);
    setBaseUrl(nextUrl);
  }

  function handleBaseUrlChange(event: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const next = event.currentTarget.value;
    setBaseUrl(next);
    setBackendMode(resolveBackendMode(next));
  }

  async function loadDynamoTables(currentBaseUrl?: string) {
    try {
      const base = normalizeBaseUrl(currentBaseUrl ?? baseUrl);
      const res = await fetch(`${base}/tables`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { tables?: string[] };
      setDynamoTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch { /* silent */ }
  }

  async function loadGlueTables(db?: string) {
    const database = (db ?? glueDbName ?? 'fhir-table-db').trim();
    if (!database) return;
    setGlueTablesLoading(true);
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/glue/databases/${encodeURIComponent(database)}/tables`,
        { headers: authHeaders() },
      );
      if (!res.ok) { setGlueTables([]); return; }
      const data = await res.json() as { tables?: string[] };
      setGlueTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch { /* silent */ }
    finally { setGlueTablesLoading(false); }
  }

  async function loadOptions(currentBaseUrl: string) {
    try {
      const base = normalizeBaseUrl(currentBaseUrl);
      const res = await fetch(`${base}/medications/?limit=250`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as unknown[] | { items?: unknown[]; data?: unknown[] };
      const items: Record<string, unknown>[] = Array.isArray(data) ? data as Record<string, unknown>[] : Array.isArray((data as { items?: unknown[] }).items) ? (data as { items: Record<string, unknown>[] }).items : [];

      const medChoices: MedicationOption[] = items.filter((i) => i?.id).map((i) => ({
        value: String(i.id),
        label: `${i.id} — ${i.description ?? i.code ?? 'Unnamed'}`,
      }));
      const ptChoices  = [...new Set(items.map((i) => i?.patient as string).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const codeChoices = [...new Set(items.map((i) => i?.code as string).filter(Boolean))].sort((a, b) => a.localeCompare(b));

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

  useEffect(() => { loadOptions(baseUrl); loadDynamoTables(baseUrl); loadGlueTables(); }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedPath = useMemo(() => {
    if (selected.needsId)               return selected.path.replace('{id}',           encodeURIComponent(medicationId.trim()));
    if (selected.needsPatient)          return selected.path.replace('{patient}',      encodeURIComponent(patient.trim()));
    if (selected.needsCode)             return selected.path.replace('{code}',         encodeURIComponent(code.trim()));
    if (selected.needsMedicationPathId) return selected.path.replace('{medicationId}', encodeURIComponent(medicationPathId.trim()));
    if (selected.needsDatabase)         return selected.path.replace('{database}',     encodeURIComponent(databaseName.trim()));
    return selected.path;
  }, [selected, medicationId, patient, code, medicationPathId, databaseName]);

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

  function handleFileSelection(event: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const file = event.currentTarget.files?.[0] ?? null;
    setSelectedFile(file);
    setSelectedFileName(file ? file.name : '');
    if (file && !uploadTableName.trim()) setUploadTableName(inferTableNameFromFileName(file.name));
  }

  async function uploadCsvToTable() {
    const base = normalizeBaseUrl(baseUrl);
    const resolvedTable = uploadTableName.trim() || inferTableNameFromFileName(selectedFileName);

    if (!selectedFile && !resolvedTable) { setStatus('Select a CSV file first.'); return; }

    setIsLoading(true);
    setStatus('Preparing upload...');
    setResult('');

    try {
      const sizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(1) : 0;
      if (selectedFile) setStatus(`Reading ${selectedFile.name} (${sizeMb} MB)...`);

      const formData = new FormData();
      formData.append('tableName', resolvedTable);
      if (selectedFile) formData.append('csvFile', selectedFile);

      setStatus('Uploading to DynamoDB via Django… this can take several minutes for large files.');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20 * 60 * 1000);

      let res = await fetch(`${base}/upload/file`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* raw text */ }

      if (res.status === 409 && (parsed as { requiresConfirmation?: boolean })?.requiresConfirmation) {
        const ok = window.confirm(`${(parsed as { message?: string }).message}\n\nClick OK to delete the existing table and upload fresh data.\nClick Cancel to abort.`);
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
      if ((err as { name?: string }).name === 'AbortError') {
        setStatus('Upload timed out (>20 min). Backend may still be processing.');
        setResult('Check backend logs and refresh the table list.');
      } else {
        setStatus('Upload failed');
        setResult((err as Error).message ?? String(err));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function closeLoaderModal() { setShowLoaderModal(false); setSelectedId('getAll'); }

  async function openBucketBrowser(bucket: string) {
    setBrowserBucket(bucket);
    setBrowserPrefix('');
    setBucketObjects([]);
    setBucketObjectsError('');
    setShowBucketBrowser(true);
    await loadBucketObjects(bucket, '');
  }

  async function loadBucketObjects(bucket: string, prefix: string) {
    setBucketObjectsLoading(true);
    setBucketObjectsError('');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      const res = await fetch(`${base}/export/s3/${encodeURIComponent(bucket)}/objects${qs}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({})) as { objects?: BucketObject[]; message?: string };
      if (res.ok) {
        setBucketObjects(data.objects ?? []);
      } else {
        setBucketObjectsError(data.message ?? `Error ${res.status}`);
      }
    } catch (err) {
      setBucketObjectsError((err as Error).message ?? String(err));
    } finally {
      setBucketObjectsLoading(false);
    }
  }

  async function downloadObject(bucket: string, key: string) {
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/s3/${encodeURIComponent(bucket)}/download?key=${encodeURIComponent(key)}`,
        { headers: authHeaders() },
      );
      const data = await res.json().catch(() => ({})) as { url?: string; message?: string };
      if (res.ok && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(data.message ?? 'Could not generate download link.');
      }
    } catch (err) {
      alert((err as Error).message ?? String(err));
    }
  }

  async function handleDeleteBucket(bucket: string) {
    const confirmed = window.confirm(`Delete bucket "${bucket}"?\n\nChoose OK to also EMPTY and delete the bucket.\nChoose Cancel to abort.`);
    if (!confirmed) return;
    setDeletingBucket(true);
    try {
      const base = normalizeBaseUrl(baseUrl);
      const res = await fetch(
        `${base}/export/s3/${encodeURIComponent(bucket)}?force=true`,
        { method: 'DELETE', headers: authHeaders() },
      );
      const data = await res.json().catch(() => ({})) as { message?: string; buckets?: string[] };
      if (res.ok) {
        setShowBucketBrowser(false);
        const res2 = await fetch(`${base}/export/s3/buckets`, { headers: authHeaders() });
        const data2 = await res2.json().catch(() => ({})) as { buckets?: string[] };
        setBucketList(Array.isArray(data2.buckets) ? data2.buckets : []);
        alert(`Bucket "${bucket}" deleted successfully.`);
      } else {
        alert(data.message ?? `Delete failed (${res.status})`);
      }
    } catch (err) {
      alert((err as Error).message ?? String(err));
    } finally {
      setDeletingBucket(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
  }

  async function runRequest(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
    event.preventDefault();

    if (selected.id === 'uploadFile') {
      setShowLoaderModal(true);
      setStatus('Opened CSV → DynamoDB uploader.');
      return;
    }

    if (selected.id === 'pipelineAll' || selected.id === 'pipelineFromCsv') {
      let body: unknown;
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
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line) as PipelineEvent;
              setPipelineEvents((prev) => [...prev, evt]);
            } catch { /* skip malformed line */ }
          }
        }
      }).catch((err: Error) => {
        setPipelineEvents((prev) => [...prev, { event: 'error', message: err.message }]);
      }).finally(() => {
        setPipelineRunning(false);
        setStatus('Pipeline complete.');
        loadGlueTables();
      });
      return;
    }

    if (selected.needsId && !medicationId.trim())                { setStatus('Medication ID is required.'); return; }
    if (selected.needsPatient && !patient.trim())                 { setStatus('Patient is required.'); return; }
    if (selected.needsCode && !code.trim())                       { setStatus('Code is required.'); return; }
    if (selected.needsMedicationPathId && !medicationPathId.trim()) { setStatus('Medication ID is required.'); return; }
    if (selected.needsDatabase && !databaseName.trim())           { setStatus('Database name is required.'); return; }

    const base = normalizeBaseUrl(baseUrl);
    const url  = base + resolvedPath + requestQueryString;
    const opts: RequestInit = { method: selected.method, headers: authHeaders() };

    if (selected.needsFileUpload) {
      const payload: Record<string, unknown> = {};
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
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* raw */ }

      if (selected.needsFileUpload && res.status === 409 && (parsed as { requiresConfirmation?: boolean })?.requiresConfirmation) {
        const ok = window.confirm(`${(parsed as { message?: string }).message}\n\nClick OK to replace the table. Click Cancel to abort.`);
        if (ok) {
          const body2 = opts.body ? JSON.parse(opts.body as string) : {};
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
        if (selected.id === 'listBuckets' && Array.isArray((parsed as { buckets?: string[] }).buckets)) {
          setBucketList((parsed as { buckets: string[] }).buckets);
          setSelectedBucket('');
          setShowBucketListModal(true);
        } else {
          setShowResponseModal(true);
        }
      } else {
        setTableRows([]);
      }

      if (['POST','PUT','DELETE'].includes(selected.method) || selected.id === 'uploadMedCsv') {
        loadOptions(baseUrl);
      }
      if ((selected.id === 'uploadMedCsv' || selected.id === 'uploadJson') && res.status === 200) {
        await loadDynamoTables(baseUrl);
      }
    } catch (err) {
      setStatus('Request failed');
      setResult((err as Error).message ?? String(err));
    } finally {
      setIsLoading(false);
    }
  }

  function restartExplorer() {
    setBackendTarget('cmdline');
    setSelectedId('getAll');
    setMedicationId(medicationOptions[0]?.value ?? '');
    setMedicationPathId(medicationOptions[0]?.value ?? '');
    setPatient(patientOptions[0] ?? '');
    setCode(codeOptions[0] ?? '');
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
      const data = await res.json() as { tree?: SrcTreeNode[] };
      setSrcTree(data.tree ?? []);
      setSrcTreeLoaded(true);
    } catch (e) {
      setSrcError((e as Error).message);
    } finally {
      setSrcLoading(false);
    }
  }

  const TERRAFORM_FILES: SourceFile[] = [
    { path: 'infra/terraform/flask-fargate-ecs/main.tf',         label: 'main.tf — ECR · ECS · ALB · IAM · OIDC' },
    { path: 'infra/terraform/flask-fargate-ecs/variables.tf',    label: 'variables.tf' },
    { path: 'infra/terraform/flask-fargate-ecs/terraform.tfvars',label: 'terraform.tfvars' },
    { path: 'infra/terraform/flask-fargate-ecs/outputs.tf',      label: 'outputs.tf' },
  ];
  const DOCKER_FILES: SourceFile[] = [
    { path: 'Dockerfile',              label: 'Dockerfile — container build' },
    { path: 'docker-compose.flask.yml',label: 'docker-compose.flask.yml — local stack' },
  ];
  const YAML_FILES: SourceFile[] = [
    { path: '.github/workflows/flask-dynamo-db-backend.yml', label: 'flask-dynamo-db-backend.yml — CI/CD pipeline' },
  ];
  const LAMBDA_FILES: SourceFile[] = [
    { path: 'lambdas/synthetic_fhir_claims.py', label: 'synthetic_fhir_claims.py — generates synthetic FHIR claims CSV' },
    { path: 'lambdas/claims_cleaner.py',        label: 'claims_cleaner.py — clean CSV + register in Glue catalog' },
  ];

  function switchDocsMode(mode: string) {
    setDocsMode(mode);
    setSrcContent(''); setSrcError(''); setSrcSelectedPath('');
    if (mode === 'deploy')       loadSourceFile('aws-cli-deploy.md');
    else if (mode === 'readme')      loadSourceFile('README.md');
    else if (mode === 'terraform')   loadSourceFile(TERRAFORM_FILES[0].path);
    else if (mode === 'docker')      loadSourceFile(DOCKER_FILES[0].path);
    else if (mode === 'yaml')        loadSourceFile(YAML_FILES[0].path);
    else if (mode === 'lambdas')     loadSourceFile(LAMBDA_FILES[0].path);
    else if (mode === 'permissions') loadSourceFile('aws-permissions.md');
    else if (mode === 'browse')      { setSrcTree([]); setSrcTreeLoaded(false); loadSourceTree(); }
  }

  async function loadSourceFile(path: string) {
    if (!path) { setSrcContent(''); setSrcSelectedPath(''); return; }
    setSrcSelectedPath(path);
    setSrcLoading(true);
    setSrcContent('');
    setSrcError('');
    try {
      const res = await fetch(`${normalizedBaseUrl}/source/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { content?: string };
      setSrcContent(data.content ?? '');
    } catch (e) {
      setSrcError((e as Error).message);
    } finally {
      setSrcLoading(false);
    }
  }

  function toggleSrcDir(path: string) {
    setSrcExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function renderSrcTree(nodes: SrcTreeNode[], depth = 0): ComponentChildren {
    return nodes.map((node) => (
      <div key={node.path} style={{ paddingLeft: `${depth * 14}px` }}>
        {node.type === 'dir' ? (
          <>
            <div onClick={() => toggleSrcDir(node.path)}
              style={{ cursor: 'pointer', userSelect: 'none', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '4px' }}>
              <span style={{ fontSize: '10px', color: '#64748b' }}>{srcExpanded.has(node.path) ? '▼' : '▶'}</span>
              <span>📁 {node.name}</span>
            </div>
            {srcExpanded.has(node.path) && renderSrcTree(node.children ?? [], depth + 1)}
          </>
        ) : (
          <div onClick={() => loadSourceFile(node.path)}
            style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: '4px',
              color: srcSelectedPath === node.path ? '#0f766e' : '#334155',
              fontWeight: srcSelectedPath === node.path ? 700 : 400,
              background: srcSelectedPath === node.path ? '#f0fdf4' : 'transparent' }}>
            📄 {node.name}
          </div>
        )}
      </div>
    ));
  }

  // -------------------------------------------------------------------------
  // Full-screen login gate
  // -------------------------------------------------------------------------
  if (!authToken) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          padding: '40px 48px', width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🏥</div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Django Application</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              {IS_FARGATE ? 'AWS' : 'localhost:4002'} — sign in to continue
            </p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
              Email
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.currentTarget.value)}
                autoComplete="username" required
                style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #475569',
                  background: '#0f172a', color: '#f1f5f9', fontSize: '14px', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
              Password
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.currentTarget.value)}
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
                color: '#fff', fontWeight: 700, fontSize: '15px', cursor: loginLoading ? 'not-allowed' : 'pointer' }}>
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <a href={LANDING_URL} style={{ fontSize: '13px', color: '#60a5fa', textDecoration: 'none' }}>
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
          <p className="eyebrow">Django Application</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <h1>TypeScript Test-Client for Django APIs</h1>
            <a href={LANDING_URL}
               style={{ fontSize: '13px', color: '#60a5fa', textDecoration: 'none', border: '1px solid #1e3a5f', borderRadius: '6px', padding: '4px 10px', whiteSpace: 'nowrap' }}
            >🏠 Landing Page</a>
          </div>
          <p className="lede">
            Drive the Django medication routes, generic CSV uploader, S3 export and Glue registration
            from a single React UI. All requests include the JWT stored in{' '}
            <code>localStorage.healthCareToken</code>.
          </p>
          <div className="hero-status" aria-live="polite">
            <span className={isLoading ? 'status-dot busy' : 'status-dot'} />
            <span>{isLoading ? 'Request in progress...' : 'Ready'}</span>
          </div>

          {/* Backend selector */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f766e', marginBottom: '8px' }}>Connect to backend</div>
            <div className="backend-group" role="group" aria-label="Backend target">
              {(['cmdline', 'docker', 'aws'] as const).map((mode) => (
                <button key={mode} type="button"
                  className={backendMode === mode ? 'backend-option active' : 'backend-option'}
                  onClick={() => setBackendTarget(mode)}
                  disabled={modeLocked ? mode !== loginMode : (IS_FARGATE && mode !== 'aws')}>
                  {mode === 'cmdline' ? 'Command Line' : mode === 'docker' ? 'Docker' : `AWS${IS_FARGATE ? ' ✓' : ''}`}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px' }}>
              {backendMode === 'aws'
                ? <>AWS &mdash; <code style={{ fontSize: '11px' }}>{BACKEND_PRESETS.aws.replace(/^https?:\/\//, '')}</code></>
                : <>localhost:4002 &mdash; {backendMode === 'docker' ? 'docker compose up' : 'python manage.py runserver 4002'}</>}
            </div>

            {/* Microservices toggle */}
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" onClick={() => setMicroservicesMode((m) => !m)}
                style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                  border: `1px solid ${microservicesMode ? '#0f766e' : '#475569'}`,
                  background: microservicesMode ? 'linear-gradient(135deg,#0f766e22,#06402022)' : 'transparent',
                  color: microservicesMode ? '#0f766e' : '#94a3b8', cursor: 'pointer' }}>
                {microservicesMode ? '⚡ Microservices ON' : '⚡ Microservices OFF'}
              </button>
            </div>

            {/* Per-service URL editor */}
            <div style={{ marginTop: '10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
              <div style={{ fontWeight: 700, color: '#7dd3fc', marginBottom: '8px', letterSpacing: '0.08em' }}>MICROSERVICE URLS</div>
              {([
                { key: 'glueCatalog',     label: '🗄️ Glue Catalog',    port: 30000 },
                { key: 'claimsGenerator', label: '🏥 Claims Generator', port: 30001 },
                { key: 'claimsCleaner',   label: '🧹 Claims Cleaner',   port: 30002 },
                { key: 'sqsMonitor',      label: '📬 SQS Monitor',      port: 30003 },
                { key: 'athenaClient',    label: '🗄 Athena Client',     port: 30004 },
              ] as Array<{ key: keyof ServiceUrls; label: string; port: number }>).map(({ key, label, port }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ width: '140px', color: '#94a3b8', flexShrink: 0 }}>{label}</span>
                  <input value={serviceUrls[key] ?? `http://localhost:${port}`}
                    onChange={(e) => setServiceUrls((u) => ({ ...u, [key]: e.currentTarget.value }))}
                    style={{ flex: 1, background: '#1e293b', border: '1px solid #334155',
                      borderRadius: '4px', color: '#e2e8f0', padding: '3px 8px', fontSize: '12px' }} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '10px', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setShowApiModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f766e,#065f46)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🔬 API Explorer
            </button>
            <SwaggerDocsButton normalizedBaseUrl={normalizedBaseUrl} />
            <button type="button" onClick={() => { setShowDocsModal(true); setDocsMode('deploy'); loadSourceFile('aws-cli-deploy.md'); }}
              style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📖 Documentation &amp; Source Files
            </button>
            <button type="button" onClick={() => setShowGlueModal(true)}
              style={{ background: 'linear-gradient(135deg,#d97706,#b45309)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄️ Load Glue Catalog
            </button>
            <button type="button" onClick={() => setShowClaimsViewModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f766e,#0e7490)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🏥 synthetic_fhir_claims_lambda
            </button>
            <button type="button" onClick={() => setShowClaimsModal(true)}
              style={{ background: 'linear-gradient(135deg,#065f46,#047857)', color: '#6ee7b7', border: '1px solid #059669', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄️ claims_clean_&amp;_glue_catalog_lambda
            </button>
            <button type="button" onClick={() => setShowSQSModal(true)}
              style={{ background: 'linear-gradient(135deg,#0f4c81,#1a73e8)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📬 SQS Monitor
            </button>
            <button type="button" onClick={() => setShowAthenaModal(true)}
              style={{ background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#7dd3fc', border: '1px solid #2563eb', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🗄 Athena Client
            </button>
            <button type="button" onClick={() => setShowPatientsModal(true)}
              style={{ background: 'linear-gradient(135deg,#7e22ce,#6d28d9)', color: '#e9d5ff', border: '1px solid #8b5cf6', borderRadius: '6px', padding: '5px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🧬 Patients &amp; Encounters
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
            <div className="meta" style={{ color: '#059669', fontWeight: 700 }}>✅ Authenticated — JWT token active</div>
            {loginStatus && <div className="meta">{loginStatus}</div>}
            <button type="button" onClick={handleLogout} style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)' }}>Log Out</button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="form">
            <div className="meta" style={{ color: '#b45309', fontWeight: 600 }}>No token — log in to make authenticated requests.</div>
            <label>Email<input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.currentTarget.value)} autoComplete="username" /></label>
            <label>Password<input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.currentTarget.value)} autoComplete="current-password" /></label>
            {loginStatus && <div className="meta" style={{ color: '#b91c1c' }}>{loginStatus}</div>}
            <button type="submit" disabled={loginLoading}>{loginLoading ? 'Logging in...' : 'Log In'}</button>
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
        <div className="meta">DynamoDB tables on the current backend.</div>
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
        <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => loadDynamoTables(baseUrl)}>Refresh Table List</button>
      </section>

      {/* CSV → DynamoDB Uploader Modal */}
      {showLoaderModal && (
        <div className="modal-backdrop" onClick={closeLoaderModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>CSV → DynamoDB Uploader</h3>
              <button type="button" onClick={closeLoaderModal}>Close</button>
            </div>
            <div className="meta" style={{ marginTop: '8px' }}>
              Sends <code>multipart/form-data</code> to <strong>POST /upload/file</strong>.
            </div>
            <div className="form" style={{ marginTop: '0.75rem' }}>
              <label>
                DynamoDB Table Name
                <input value={uploadTableName} onChange={(e) => setUploadTableName(e.currentTarget.value)} placeholder="auto-detected from file name" />
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
              <button type="button" disabled={isLoading} onClick={uploadCsvToTable}>
                {isLoading ? 'Uploading...' : 'Upload CSV to DynamoDB'}
              </button>
              <h3 style={{ marginTop: '1.25rem' }}>Loaded Tables</h3>
              {dynamoTables.length === 0
                ? <div className="meta">No tables yet.</div>
                : (
                  <div className="dynamo-table-grid">
                    {dynamoTableRows.map((row, ri) => (
                      <div className="dynamo-table-row" key={`mrow-${ri}`}>
                        {row.map((t) => <span className="dynamo-table-name" key={t}>{t}</span>)}
                      </div>
                    ))}
                  </div>
                )}
              <button type="button" style={{ marginTop: '0.75rem' }} onClick={() => loadDynamoTables(baseUrl)}>Refresh Table List</button>
            </div>
          </div>
        </div>
      )}

      {/* S3 Bucket List Modal */}
      {showBucketListModal && (
        <div className="modal-backdrop" onClick={() => setShowBucketListModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>S3 Buckets ({bucketList.length})</h3>
              <button type="button" onClick={() => setShowBucketListModal(false)}>Close</button>
            </div>
            <div className="bucket-list-wrap">
              <table className="bucket-list-table">
                <thead><tr><th style={{ width: '36px' }}></th><th>Bucket Name</th><th style={{ width: '110px' }}></th></tr></thead>
                <tbody>
                  {bucketList.map((b) => (
                    <tr key={b} className={selectedBucket === b ? 'bucket-row selected' : 'bucket-row'} onClick={() => setSelectedBucket(b)}>
                      <td><input type="radio" name="bucket-select" checked={selectedBucket === b} onChange={() => setSelectedBucket(b)} onClick={(e) => e.stopPropagation()} /></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{b}</td>
                      <td><button type="button" className="btn-open-bucket" onClick={(e) => { e.stopPropagation(); setShowBucketListModal(false); openBucketBrowser(b); }}>Open ›</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
              <button type="button" disabled={!selectedBucket} onClick={() => { setShowBucketListModal(false); openBucketBrowser(selectedBucket); }}>Open Selected Bucket</button>
              <button type="button" style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)' }} disabled={!selectedBucket} onClick={() => handleDeleteBucket(selectedBucket)}>Delete Bucket</button>
            </div>
          </div>
        </div>
      )}

      {/* S3 Bucket Browser Modal */}
      {showBucketBrowser && (
        <div className="modal-backdrop" onClick={() => setShowBucketBrowser(false)}>
          <div className="modal-card bucket-browser-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><span style={{ color: '#64748b', fontWeight: 400 }}>s3://</span>{browserBucket}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" style={{ background: 'linear-gradient(135deg,#b91c1c,#7f1d1d)', fontSize: '12px', padding: '4px 12px' }} disabled={deletingBucket} onClick={() => handleDeleteBucket(browserBucket)}>
                  {deletingBucket ? 'Deleting...' : 'Delete Bucket'}
                </button>
                <button type="button" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={() => { setShowBucketBrowser(false); setShowBucketListModal(true); }}>‹ Back to List</button>
                <button type="button" onClick={() => setShowBucketBrowser(false)}>Close</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
              <input style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }} value={browserPrefix}
                onChange={(e) => setBrowserPrefix(e.currentTarget.value)} placeholder="Filter by prefix (e.g. dynamodb-exports/)" />
              <button type="button" style={{ whiteSpace: 'nowrap', fontSize: '13px', padding: '6px 14px' }} onClick={() => loadBucketObjects(browserBucket, browserPrefix)}>Refresh</button>
            </div>
            {bucketObjectsError && <div className="meta" style={{ color: '#b91c1c', marginTop: '8px' }}>{bucketObjectsError}</div>}
            {bucketObjectsLoading ? (
              <div className="progress-wrap" style={{ marginTop: '16px' }}><div className="progress-bar" /></div>
            ) : (
              <div className="modal-table-wrap" style={{ marginTop: '12px' }}>
                {bucketObjects.length === 0 ? (
                  <div className="meta">No objects found{browserPrefix ? ` with prefix "${browserPrefix}"` : ''}.</div>
                ) : (
                  <table className="bucket-objects-table">
                    <thead><tr><th>Key</th><th style={{ width: '90px' }}>Size</th><th style={{ width: '190px' }}>Last Modified</th><th style={{ width: '100px' }}></th></tr></thead>
                    <tbody>
                      {bucketObjects.map((obj) => (
                        <tr key={obj.key}>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{obj.key}</td>
                          <td style={{ textAlign: 'right', fontSize: '12px' }}>{formatBytes(obj.size)}</td>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{obj.lastModified ? new Date(obj.lastModified).toLocaleString() : '-'}</td>
                          <td><button type="button" className="btn-download" onClick={() => downloadObject(browserBucket, obj.key)}>⬇ Download</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
        renderSrcTree={renderSrcTree} setSrcFullscreen={setSrcFullscreen} loadSourceFile={loadSourceFile}
        TERRAFORM_FILES={TERRAFORM_FILES} DOCKER_FILES={DOCKER_FILES} YAML_FILES={YAML_FILES} LAMBDA_FILES={LAMBDA_FILES}
      />

      {/* Glue Catalog Uploader */}
      <GlueCatalogUploader
        show={showGlueModal} onClose={() => setShowGlueModal(false)}
        baseUrl={microservicesMode ? serviceUrls.glueCatalog : baseUrl}
        authToken={authToken} buckets={bucketList}
      />

      {/* Toasts */}
      {quickGenToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: quickGenToast.ok ? '#052e16' : '#1f0d0d',
          border: `1px solid ${quickGenToast.ok ? '#16a34a' : '#dc2626'}`, color: quickGenToast.ok ? '#86efac' : '#fca5a5',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxWidth: 420 }}>
          {quickGenToast.msg}
        </div>
      )}
      {quickCleanToast && (
        <div style={{ position: 'fixed', bottom: 68, right: 24, zIndex: 9999, background: quickCleanToast.ok ? '#0c1a3a' : '#1f0d0d',
          border: `1px solid ${quickCleanToast.ok ? '#2563eb' : '#dc2626'}`, color: quickCleanToast.ok ? '#bfdbfe' : '#fca5a5',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxWidth: 420 }}>
          {quickCleanToast.msg}
        </div>
      )}

      {/* Claims Generator */}
      <ClaimsGenerator
        show={showClaimsViewModal} onClose={() => setShowClaimsViewModal(false)}
        baseUrl={microservicesMode ? serviceUrls.claimsGenerator : baseUrl}
        cleanerUrl={microservicesMode ? serviceUrls.claimsCleaner : baseUrl}
        authToken={authToken} catalogEnabled={false} generateOnOpen={true}
      />
      <ClaimsGenerator
        show={showClaimsModal} onClose={() => setShowClaimsModal(false)}
        baseUrl={microservicesMode ? serviceUrls.claimsGenerator : baseUrl}
        cleanerUrl={microservicesMode ? serviceUrls.claimsCleaner : baseUrl}
        authToken={authToken} catalogEnabled={true}
        onGenerateSuccess={() => { setShowClaimsModal(false); setShowSQSModal(true); }}
      />

      {/* SQS Monitor */}
      <SQSMonitor show={showSQSModal} onClose={() => setShowSQSModal(false)}
        baseUrl={microservicesMode ? serviceUrls.sqsMonitor : baseUrl} authToken={authToken} />

      {/* Athena Client */}
      <AthenaClient show={showAthenaModal} onClose={() => setShowAthenaModal(false)}
        baseUrl={microservicesMode ? serviceUrls.athenaClient : baseUrl} authToken={authToken} />

      {/* Patients & Encounters */}
      <PatientsEncounters show={showPatientsModal} onClose={() => setShowPatientsModal(false)}
        baseUrl={microservicesMode ? serviceUrls.patientsEncounters : baseUrl} authToken={authToken} />

      {/* Source Browser */}
      <section className="panel">
        <h2>Source Browser</h2>
        <p style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
          Browse the full project source — Django backend, React UI, Terraform, Docker, Jupyter notebooks, and GitHub Actions CI/CD.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Quick View:</label>
          <select value={srcQuickFile} onChange={(e) => setSrcQuickFile(e.currentTarget.value)}
            style={{ flex: 1, minWidth: '220px', fontSize: '13px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}>
            <option value="">— select a key file —</option>
            <option value="aws-permissions.md">🔐 aws-permissions.md</option>
            <option value="aws-cli-deploy.md">🚀 aws-cli-deploy.md</option>
            <option value="README.md">📖 README.md</option>
            <optgroup label="Django App">
              <option value="django-back-end/manage.py">manage.py</option>
              <option value="django-back-end/Dockerfile">Dockerfile</option>
              <option value="django-back-end/requirements.txt">requirements.txt</option>
            </optgroup>
            <optgroup label="Lambda Functions">
              <option value="lambdas/synthetic_fhir_claims.py">synthetic_fhir_claims.py</option>
              <option value="lambdas/claims_cleaner.py">claims_cleaner.py</option>
            </optgroup>
          </select>
          <button type="button" disabled={!srcQuickFile || srcLoading}
            onClick={() => srcQuickFile && loadSourceFile(srcQuickFile)}
            style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600,
              background: srcQuickFile ? '#0f766e' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '6px', cursor: srcQuickFile ? 'pointer' : 'default' }}>
            View
          </button>
          {!srcTreeLoaded ? (
            <button type="button" disabled={srcLoading} onClick={loadSourceTree}
              style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              {srcLoading && !srcContent ? 'Loading...' : 'Browse All Files'}
            </button>
          ) : (
            <button type="button" onClick={() => { setSrcTreeLoaded(false); setSrcTree([]); setSrcExpanded(new Set()); }}
              style={{ padding: '6px 14px', fontSize: '13px', color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>
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
          {srcTreeLoaded && (
            <div style={{ width: '250px', flexShrink: 0, overflowY: 'auto', maxHeight: '520px',
              borderRight: '1px solid #e2e8f0', paddingRight: '10px', fontSize: '12.5px', fontFamily: '"Fira Mono", monospace', lineHeight: '1.5' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: '8px' }}>/source</div>
              {srcTree.length > 0 ? renderSrcTree(srcTree) : <div style={{ color: '#94a3b8', fontSize: '12px' }}>No files found</div>}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            {srcFullscreen ? (
              <div style={{ position: 'fixed', inset: 0, background: '#0f172a', zIndex: 9000, display: 'flex', flexDirection: 'column', padding: '16px' }}>
                <FileContentViewer content={srcContent} filePath={srcSelectedPath} isLoading={srcLoading}
                  onFullScreen={() => setSrcFullscreen(false)}
                  onClose={() => { setSrcFullscreen(false); setSrcContent(''); setSrcSelectedPath(''); }} />
              </div>
            ) : (
              <FileContentViewer content={srcContent} filePath={srcSelectedPath} isLoading={srcLoading}
                emptyMessage="Select a file above or browse the tree."
                onFullScreen={() => setSrcFullscreen(true)}
                onClose={() => { setSrcContent(''); setSrcSelectedPath(''); }} />
            )}
          </div>
        </div>
      </section>

      {/* Response Table Modal */}
      {showResponseModal && tableRows.length > 0 && (
        <div className="modal-backdrop" style={{ zIndex: 1100 }} onClick={() => setShowResponseModal(false)}>
          <div className="modal-card" style={{ maxWidth: '900px', width: '95vw', maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Results ({tableRows.length} rows)</h3>
              <button type="button" onClick={() => setShowResponseModal(false)}>Close</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {tableColumns.map((col) => (
                      <th key={col} style={{ background: '#0f172a', color: '#94a3b8', padding: '7px 10px', textAlign: 'left',
                        position: 'sticky', top: 0, whiteSpace: 'nowrap', borderBottom: '1px solid #1e293b' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      {tableColumns.map((col) => (
                        <td key={col} style={{ padding: '5px 10px', borderBottom: '1px solid #f1f5f9' }}>
                          {getCellValue(row, col)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Modal */}
      {showPipelineModal && (
        <div className="modal-backdrop" style={{ zIndex: 1100 }} onClick={() => !pipelineRunning && setShowPipelineModal(false)}>
          <div className="modal-card" style={{ maxWidth: '640px', width: '95vw', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{pipelineRunning ? '⏳ Pipeline Running…' : '✅ Pipeline Complete'}</h3>
              {!pipelineRunning && <button type="button" onClick={() => setShowPipelineModal(false)}>Close</button>}
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pipelineEvents.map((evt, i) => (
                <div key={i} style={{ fontSize: '12px', fontFamily: 'monospace', padding: '4px 8px', borderRadius: '4px',
                  background: evt.event === 'error' ? '#1f0d0d' : '#0f172a',
                  color: evt.event === 'error' ? '#fca5a5' : evt.event === 'complete' ? '#6ee7b7' : '#e2e8f0',
                  border: `1px solid ${evt.event === 'error' ? '#7f1d1d' : '#1e293b'}` }}>
                  [{evt.event}] {evt.message ?? JSON.stringify(evt)}
                </div>
              ))}
              {pipelineRunning && <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>Streaming events…</div>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
