import React, { useEffect, useMemo, useState } from 'react';

const TOKEN_KEY = 'healthCareToken';
function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const API_OPTIONS = [
  { id: 'getAll', label: 'GET /medications/', method: 'GET', path: '/medications/', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: true, supportsQueryFilters: true, needsFileUpload: false },
  { id: 'getById', label: 'GET /medications/id/:id', method: 'GET', path: '/medications/id/{id}', needsBody: false, needsId: true, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByPatient', label: 'GET /medications/patient/:patient', method: 'GET', path: '/medications/patient/{patient}', needsBody: false, needsId: false, needsPatient: true, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByCode', label: 'GET /medications/code/:code', method: 'GET', path: '/medications/code/{code}', needsBody: false, needsId: false, needsPatient: false, needsCode: true, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getByMedicationPath', label: 'GET /medications/medication/:medicationId', method: 'GET', path: '/medications/medication/{medicationId}', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: true, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'getPatientsMulti', label: 'GET /medications/patients/multiple-medications', method: 'GET', path: '/medications/patients/multiple-medications', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: true, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'postMedication', label: 'POST /medications/', method: 'POST', path: '/medications/', needsBody: true, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'putMedication', label: 'PUT /medications/:id', method: 'PUT', path: '/medications/{id}', needsBody: true, needsId: true, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'deleteMedication', label: 'DELETE /medications/:id', method: 'DELETE', path: '/medications/{id}', needsBody: false, needsId: true, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'uploadCsv', label: 'POST /medications/upload', method: 'POST', path: '/medications/upload', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: true },
  { id: 'listTables', label: 'GET /tables', method: 'GET', path: '/tables', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false },
  { id: 'launchFrontend', label: 'DynamoDB Table Loader', method: 'GET', path: '/launch/frontend', needsBody: false, needsId: false, needsPatient: false, needsCode: false, needsMedicationPathId: false, needsTopN: false, supportsQueryFilters: false, needsFileUpload: false }
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
  reasonDescription: 'Demo payload'
};

const DEFAULT_UPLOAD_BODY = {
  tableName: 'medications',
  csvPath: 'C:/Users/Dan/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/coherent-11-07-2022/csv/medications.csv'
};

const TABLE_COLUMNS = [
  'id',
  'start',
  'stop',
  'patient',
  'payer',
  'encounter',
  'code',
  'description',
  'baseCost',
  'payerCoverage',
  'dispenses',
  'totalCost',
  'reasonCode',
  'reasonDescription'
];

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function normalizeRowsFromResponse(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === 'object');
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.items)) {
      return payload.items.filter((row) => row && typeof row === 'object');
    }

    if (Array.isArray(payload.data)) {
      return payload.data.filter((row) => row && typeof row === 'object');
    }

    if (Array.isArray(payload.results)) {
      return payload.results.filter((row) => row && typeof row === 'object');
    }

    return [payload];
  }

  return [];
}

function inferTableColumns(rows) {
  const keys = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    });
  });

  if (keys.length === 0) {
    return TABLE_COLUMNS;
  }

  return keys;
}

function getCellValue(row, key) {
  const value = row[key];

  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const medicationNames = value
        .map((item) => item.medicationName || item.description || item.name || item.medicationId)
        .filter((name) => Boolean(name))
        .map((name) => String(name))
        .sort((a, b) => a.localeCompare(b));

      if (medicationNames.length > 0) {
        return (
          <span>
            {medicationNames.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className={index % 2 === 1 ? 'medication-name-alt' : ''}
              >
                {index > 0 ? ', ' : ''}
                {name}
              </span>
            ))}
          </span>
        );
      }

      return JSON.stringify(value);
    }

    return value.join(', ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return String(value);
}

function inferTableNameFromFileName(fileName) {
  const baseName = String(fileName || '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return baseName || 'uploaded_data';
}

export default function OnSubmitWorkflow({ baseUrl: initialBaseUrl }) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || 'http://localhost:4004');

  // Sync when parent switches backend preset
  useEffect(() => {
    if (initialBaseUrl) setBaseUrl(initialBaseUrl);
  }, [initialBaseUrl]);
  const [selectedId, setSelectedId] = useState('getAll');
  const [medicationId, setMedicationId] = useState('');
  const [medicationPathId, setMedicationPathId] = useState('');
  const [patientOptions, setPatientOptions] = useState([]);
  const [patient, setPatient] = useState('');
  const [codeOptions, setCodeOptions] = useState([]);
  const [code, setCode] = useState('');
  const [topN, setTopN] = useState('10');
  const [queryId, setQueryId] = useState('');
  const [queryPatientId, setQueryPatientId] = useState('');
  const [queryMedicationId, setQueryMedicationId] = useState('');
  const [uploadTableName, setUploadTableName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [medicationOptions, setMedicationOptions] = useState([]);
  const [bodyText, setBodyText] = useState(prettyJson(DEFAULT_BODY));
  const [result, setResult] = useState('Run a request to see results here.');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showLoaderModal, setShowLoaderModal] = useState(false);
  const [tableRows, setTableRows] = useState([]);
  const [tableColumns, setTableColumns] = useState(TABLE_COLUMNS);
  const [dynamoTables, setDynamoTables] = useState([]);

  const selected = useMemo(
    () => API_OPTIONS.find((option) => option.id === selectedId) || API_OPTIONS[0],
    [selectedId]
  );

  async function loadDynamoTables(currentBaseUrl) {
    try {
      const normalizedBase = (currentBaseUrl || baseUrl).trim().replace(/\/$/, '');
      const response = await fetch(`${normalizedBase}/tables`, { headers: authHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      setDynamoTables(Array.isArray(data.tables) ? data.tables.sort() : []);
    } catch (error) {
      // silently ignore — tables panel will just stay empty
    }
  }

  async function loadOptions(currentBaseUrl) {
    try {
      const normalizedBase = currentBaseUrl.trim().replace(/\/$/, '');
      const response = await fetch(`${normalizedBase}/medications/?limit=250`, { headers: authHeaders() });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

      const medicationChoices = items
        .filter((item) => item && item.id)
        .map((item) => ({
          value: String(item.id),
          label: `${item.id} - ${item.description || item.code || 'Unnamed Medication'}`
        }));

      const patientChoices = Array.from(
        new Set(
          items
            .map((item) => item && item.patient)
            .filter((value) => Boolean(value))
        )
      ).sort((a, b) => a.localeCompare(b));

      const codeChoices = Array.from(
        new Set(
          items
            .map((item) => item && item.code)
            .filter((value) => Boolean(value))
        )
      ).sort((a, b) => a.localeCompare(b));

      setMedicationOptions(medicationChoices);
      setPatientOptions(patientChoices);
      setCodeOptions(codeChoices);

      if (medicationChoices.length === 0) {
        setMedicationId('');
        setMedicationPathId('');
      } else if (!medicationChoices.some((option) => option.value === medicationId)) {
        setMedicationId(medicationChoices[0].value);
        setMedicationPathId(medicationChoices[0].value);
      } else if (!medicationChoices.some((option) => option.value === medicationPathId)) {
        setMedicationPathId(medicationChoices[0].value);
      }

      if (patientChoices.length === 0) {
        setPatient('');
      } else if (!patientChoices.includes(patient)) {
        setPatient(patientChoices[0]);
      }

      if (codeChoices.length === 0) {
        setCode('');
      } else if (!codeChoices.includes(code)) {
        setCode(codeChoices[0]);
      }
    } catch (error) {
    }
  }

  useEffect(() => {
    loadOptions(baseUrl);
    loadDynamoTables(baseUrl);
  }, [baseUrl]);

  function restartExplorer() {
    setBaseUrl('http://localhost:4001');
    setSelectedId('getAll');
    setMedicationId(medicationOptions[0]?.value || '');
    setMedicationPathId(medicationOptions[0]?.value || '');
    setPatient(patientOptions[0] || '');
    setCode(codeOptions[0] || '');
    setTopN('10');
    setQueryId('');
    setQueryPatientId('');
    setQueryMedicationId('');
    setUploadTableName('');
    setSelectedFile(null);
    setSelectedFileName('');
    setBodyText(prettyJson(DEFAULT_BODY));
    setResult('Run a request to see results here.');
    setStatus('Explorer reset');
  }

  function quitExplorer() {
    window.close();
    setStatus('Quit requested');
    setResult('If the tab did not close (browser policy), you can close it manually.');
  }

  const resolvedPath = useMemo(() => {
    if (selected.needsId) {
      return selected.path.replace('{id}', encodeURIComponent(medicationId.trim()));
    }

    if (selected.needsPatient) {
      return selected.path.replace('{patient}', encodeURIComponent(patient.trim()));
    }

    if (selected.needsCode) {
      return selected.path.replace('{code}', encodeURIComponent(code.trim()));
    }

    if (selected.needsMedicationPathId) {
      return selected.path.replace('{medicationId}', encodeURIComponent(medicationPathId.trim()));
    }

    return selected.path;
  }, [selected, medicationId, patient, code, medicationPathId]);

  const requestQueryString = useMemo(() => {
    const params = new URLSearchParams();

    if (selected.needsTopN && topN.trim()) {
      params.set('topN', topN.trim());
    }

    if (selected.supportsQueryFilters) {
      if (queryId.trim()) {
        params.set('id', queryId.trim());
      }
      if (queryPatientId.trim()) {
        params.set('patientId', queryPatientId.trim());
      }
      if (queryMedicationId.trim()) {
        params.set('medicationId', queryMedicationId.trim());
      }
    }

    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
  }, [selected, topN, queryId, queryPatientId, queryMedicationId]);

  async function runRequest(event) {
    event.preventDefault();

    if (selected.id === 'launchFrontend') {
      setShowLoaderModal(true);
      setStatus('Opened DynamoDB Table Loader dialog.');
      return;
    }

    if (selected.needsId && !medicationId.trim()) {
      setStatus('Medication ID is required.');
      return;
    }

    if (selected.needsPatient && !patient.trim()) {
      setStatus('Patient is required.');
      return;
    }

    if (selected.needsCode && !code.trim()) {
      setStatus('Code is required.');
      return;
    }

    if (selected.needsMedicationPathId && !medicationPathId.trim()) {
      setStatus('Medication ID is required.');
      return;
    }

    if (selected.needsTopN && topN.trim() && (!Number.isFinite(Number(topN)) || Number(topN) <= 0)) {
      setStatus('topN must be a positive number.');
      return;
    }

    const normalizedBase = baseUrl.trim().replace(/\/$/, '');
    const url = normalizedBase + resolvedPath + requestQueryString;
    const options = { method: selected.method, headers: { ...authHeaders() } };

    if (selected.needsFileUpload) {
      const payload = {};

      if (uploadTableName.trim()) {
        payload.tableName = uploadTableName.trim();
      }

      if (selectedFile) {
        try {
          payload.csvContent = await selectedFile.text();
          payload.fileName = selectedFile.name;
        } catch (error) {
          setStatus('Unable to read selected CSV file.');
          return;
        }
      }

      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    } else if (selected.needsBody) {
      try {
        const parsed = JSON.parse(bodyText);
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(parsed);
      } catch (error) {
        setStatus('Invalid JSON body. Fix it and try again.');
        return;
      }
    }

    setIsLoading(true);
    setStatus('Sending request...');

    try {
      let response = await fetch(url, options);
      let responseText = await response.text();
      let parsedBody = responseText;

      try {
        parsedBody = JSON.parse(responseText);
      } catch (error) {
      }

      if (
        selected.needsFileUpload
        && response.status === 409
        && parsedBody
        && typeof parsedBody === 'object'
        && parsedBody.requiresConfirmation
      ) {
        const shouldReplace = window.confirm(`${parsedBody.message}\n\nClick OK to delete the existing table and upload fresh data.\nClick Cancel to abort — the existing table will not be changed.`);
        if (shouldReplace) {
          const originalPayload = options.body ? JSON.parse(options.body) : {};
          originalPayload.replaceExistingTable = true;
          response = await fetch(url, {
            method: selected.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(originalPayload)
          });
          responseText = await response.text();
          parsedBody = responseText;
          try {
            parsedBody = JSON.parse(responseText);
          } catch (error) {
          }
        } else {
          setStatus('Upload cancelled — existing table was not modified.');
          setResult('');
          setIsLoading(false);
          return;
        }
      }

      setStatus(`${response.status} ${response.statusText}`);
      setResult(prettyJson(parsedBody));

      const rows = normalizeRowsFromResponse(parsedBody);
      if (rows.length > 0) {
        setTableColumns(inferTableColumns(rows));
        setTableRows(rows);
        setShowResponseModal(true);
      } else {
        setTableRows([]);
      }

      if (['POST', 'PUT', 'DELETE'].includes(selected.method) || selected.id === 'uploadCsv') {
        loadOptions(baseUrl);
      }

      if (selected.id === 'uploadCsv' && response.status === 200) {
        await loadDynamoTables(baseUrl);
      }
    } catch (error) {
      setStatus('Request failed');
      setResult(error.message || String(error));
    } finally {
      setIsLoading(false);
    }
  }

  function loadUploadBody() {
    setBodyText(prettyJson(DEFAULT_UPLOAD_BODY));
    setStatus('Loaded CSV upload body template');
  }

  function handleFileSelection(event) {
    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    setSelectedFile(file);
    setSelectedFileName(file ? file.name : '');

    if (file && !uploadTableName.trim()) {
      setUploadTableName(inferTableNameFromFileName(file.name));
    }
  }

  async function uploadCsvToTable() {
    const normalizedBase = baseUrl.trim().replace(/\/$/, '');
    const url = `${normalizedBase}/medications/upload`;
    const resolvedTableName = uploadTableName.trim() || inferTableNameFromFileName(selectedFileName);
    const payload = { tableName: resolvedTableName };

    setIsLoading(true);
    setStatus('Preparing upload...');
    setResult('');

    if (selectedFile) {
      try {
        const sizeMb = (selectedFile.size / (1024 * 1024)).toFixed(1);
        setStatus(`Reading ${selectedFile.name} (${sizeMb} MB)...`);
        payload.csvContent = await selectedFile.text();
        payload.fileName = selectedFile.name;
      } catch (error) {
        setStatus('Unable to read selected CSV file.');
        setResult(String(error));
        setIsLoading(false);
        return;
      }
    }

    try {
      setStatus('Uploading to DynamoDB... this can take several minutes for large CSV files.');
      const controller = new AbortController();
      const timeoutMs = 20 * 60 * 1000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      let responseText = await response.text();
      let parsedBody = responseText;
      try { parsedBody = JSON.parse(responseText); } catch (e) {}

      if (response.status === 409 && parsedBody && parsedBody.requiresConfirmation) {
        const shouldReplace = window.confirm(
          `${parsedBody.message}\n\nClick OK to delete the existing table and upload fresh data.\nClick Cancel to abort — the existing table will not be changed.`
        );
        if (!shouldReplace) {
          setStatus('Upload cancelled — existing table was not modified.');
          setResult('');
          setIsLoading(false);
          return;
        }
        payload.replaceExistingTable = true;
        setStatus('Replacing existing table and uploading data...');

        const replaceController = new AbortController();
        const replaceTimeoutMs = 20 * 60 * 1000;
        const replaceTimeoutId = setTimeout(() => replaceController.abort(), replaceTimeoutMs);

        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: replaceController.signal
        });

        clearTimeout(replaceTimeoutId);

        responseText = await response.text();
        parsedBody = responseText;
        try { parsedBody = JSON.parse(responseText); } catch (e) {}
      }

      setStatus(`${response.status} ${response.statusText}`);
      setResult(prettyJson(parsedBody));

      if (response.ok) {
        await loadDynamoTables(baseUrl);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setStatus('Upload timed out');
        setResult('The upload request exceeded 20 minutes. The backend may still be processing. Check backend logs and table list.');
      } else {
        setStatus('Upload failed');
        setResult(error.message || String(error));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function closeLoaderModal() {
    setShowLoaderModal(false);
    setSelectedId('getAll');
  }

  return (
    <main className="page">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Chapter04 DynamoDB</p>
          <h1>DynamoDB Medication API Client</h1>
          <p className="lede">Drive the DynamoDB medication routes from a single React UI and inspect every response in a table.</p>
        </div>
        <div className="hero-badge">
          <span>Backend</span>
          <strong>{baseUrl.trim().replace(/\/$/, '') || 'localhost'}</strong>
        </div>
      </section>

      <section className="panel">
        <h2>API Pull Down</h2>
        <form onSubmit={runRequest} className="form">
          <label>
            Server URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            API Call
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {API_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Running...' : 'Invoke Selected API'}
          </button>
        </form>
      </section>

      <section className="panel result">
        <h2>Response</h2>
        <div className="status">Status: {status || 'No request yet'}</div>
        {isLoading && (
          <div className="progress-wrap" aria-live="polite" aria-label="Request in progress">
            <div className="progress-bar" />
          </div>
        )}
        <pre>{result}</pre>
      </section>

      {showLoaderModal && (
        <div className="modal-backdrop" onClick={closeLoaderModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>DynamoDB Table Loader</h3>
              <button type="button" onClick={closeLoaderModal}>
                Close
              </button>
            </div>

            <div className="form" style={{ marginTop: '0.75rem' }}>
              <label>
                DynamoDB Table Name
                <input
                  value={uploadTableName}
                  onChange={(event) => setUploadTableName(event.target.value)}
                  placeholder="Enter table name (e.g. medications, patients)"
                />
              </label>
              <label>
                Choose a file to upload to DynamoDB
                <input type="file" accept=".csv,text/csv" onChange={handleFileSelection} />
              </label>
              <div className="meta">
                {selectedFileName ? `Selected: ${selectedFileName}` : 'No file selected — backend default path will be used'}
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={uploadCsvToTable}
              >
                {isLoading ? 'Uploading...' : 'Upload CSV to DynamoDB'}
              </button>
              {!uploadTableName.trim() && (
                <div className="meta" style={{ color: '#b45309' }}>Table name will be auto-generated from file name.</div>
              )}

              <h3 style={{ marginTop: '1rem' }}>DynamoDB Tables</h3>
              {dynamoTables.length === 0 ? (
                <div className="meta">No tables loaded yet. Upload a CSV or click refresh.</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: '1.8' }}>
                  {dynamoTables.map((t) => (
                    <li key={t} style={{ fontFamily: 'monospace' }}>{t}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                style={{ marginTop: '0.75rem' }}
                onClick={() => loadDynamoTables(baseUrl)}
              >
                Refresh Table List
              </button>
            </div>
          </div>
        </div>
      )}

      {showResponseModal && (
        <div className="modal-backdrop" onClick={() => setShowResponseModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Response Items</h3>
              <button type="button" onClick={() => setShowResponseModal(false)}>
                Close
              </button>
            </div>

            <div className="modal-table-wrap">
              <table>
                <thead>
                  <tr>
                    {tableColumns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, index) => (
                    <tr key={`${row.id || 'row'}-${index}`}>
                      {tableColumns.map((column) => (
                        <td key={column}>{getCellValue(row, column)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}