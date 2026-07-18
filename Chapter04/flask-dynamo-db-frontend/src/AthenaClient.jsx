import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ─── pre-built queries ─────────────────────────────────────────────────────── */
const EXAMPLES = [
  {
    label: 'Preview first 10 rows',
    sql: 'SELECT *\nFROM claims_clean\nLIMIT 10;',
  },
  {
    label: 'Total row count',
    sql: 'SELECT COUNT(*) AS total_rows\nFROM claims_clean;',
  },
  {
    label: 'Claims by status',
    sql: 'SELECT status,\n       COUNT(*)              AS claims,\n       ROUND(SUM(total_amount), 2) AS total_billed\nFROM claims_clean\nGROUP BY status\nORDER BY claims DESC;',
  },
  {
    label: 'Claims by service date',
    sql: 'SELECT service_date,\n       COUNT(*)              AS claims,\n       ROUND(SUM(total_amount), 2) AS total_billed\nFROM claims_clean\nGROUP BY service_date\nORDER BY service_date DESC\nLIMIT 30;',
  },
  {
    label: 'Payer distribution',
    sql: 'SELECT payer_name,\n       COUNT(*) AS claims,\n       ROUND(AVG(total_amount), 2) AS avg_amount\nFROM claims_clean\nGROUP BY payer_name\nORDER BY claims DESC;',
  },
  {
    label: 'Top 10 patients by spend',
    sql: 'SELECT patient_id,\n       COUNT(*)              AS claims,\n       ROUND(SUM(total_amount), 2) AS total_spend\nFROM claims_clean\nGROUP BY patient_id\nORDER BY total_spend DESC\nLIMIT 10;',
  },
  {
    label: 'Encounter class breakdown',
    sql: 'SELECT encounter_class,\n       COUNT(*) AS claims\nFROM claims_clean\nGROUP BY encounter_class\nORDER BY claims DESC;',
  },
];

/* ─── helpers ──────────────────────────────────────────────────────────────── */
const fmtBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
};

const fmtMs = (ms) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

const downloadCSV = (columns, rows, filename = 'athena-results.csv') => {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((c) => escape(row[c])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
};

/* ─── component ────────────────────────────────────────────────────────────── */
export default function AthenaClient({ show, onClose, baseUrl, authToken }) {
  const [database,       setDatabase]       = useState('fhir-table-db');
  const [databases,      setDatabases]      = useState([]);
  const [schema,         setSchema]         = useState({});   // { table: [{name,type}] }
  const [expanded,       setExpanded]       = useState({});
  const [sql,            setSql]            = useState('SELECT *\nFROM claims_clean\nLIMIT 10;');
  const [running,        setRunning]        = useState(false);
  const [result,         setResult]         = useState(null);
  const [queryError,     setQueryError]     = useState('');
  const [activeTab,      setActiveTab]      = useState('results');
  const [loadingSchema,  setLoadingSchema]  = useState(false);
  const [showExamples,   setShowExamples]   = useState(false);
  const [selectedTable,  setSelectedTable]  = useState('');
  const [showAI,         setShowAI]         = useState(true);
  const [aiPrompt,       setAiPrompt]       = useState('');
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState('');
  const [aiModel,        setAiModel]        = useState('');

  const textareaRef  = useRef(null);
  const examplesRef  = useRef(null);

  const hdrs = useCallback(
    () => ({ Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }),
    [authToken],
  );

  /* ── load databases ── */
  useEffect(() => {
    if (!show || !authToken) return;
    fetch(`${baseUrl}/athena/databases`, { headers: hdrs() })
      .then((r) => r.json())
      .then((d) => setDatabases(d.databases || []))
      .catch(() => {});
  }, [show, authToken, baseUrl, hdrs]);

  /* ── load schema when database changes ── */
  useEffect(() => {
    if (!show || !authToken || !database) return;
    setLoadingSchema(true);
    setSchema({});
    setExpanded({});
    fetch(`${baseUrl}/athena/schema?database=${encodeURIComponent(database)}`, { headers: hdrs() })
      .then((r) => r.json())
      .then((d) => setSchema(d.schema || {}))
      .catch(() => {})
      .finally(() => setLoadingSchema(false));
  }, [show, authToken, database, baseUrl, hdrs]);

  /* ── close examples on outside click ── */
  useEffect(() => {
    if (!showExamples) return;
    const handler = (e) => {
      if (examplesRef.current && !examplesRef.current.contains(e.target))
        setShowExamples(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExamples]);

  /* ── run query ── */
  const runQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setQueryError('');
    setResult(null);
    setActiveTab('results');
    try {
      const resp = await fetch(`${baseUrl}/athena/query`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ sql: trimmed, database }),
      });
      const data = await resp.json();
      if (!resp.ok || data.status === 'error') {
        setQueryError(data.error || `HTTP ${resp.status}`);
        setActiveTab('messages');
      } else {
        setResult(data);
        setActiveTab('results');
      }
    } catch (e) {
      setQueryError(String(e));
      setActiveTab('messages');
    } finally {
      setRunning(false);
    }
  }, [sql, running, database, baseUrl, hdrs]);

  /* ── keyboard shortcuts ── */
  const handleKey = (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      runQuery();
    }
  };

  /* ── table click → insert SELECT ── */
  const insertSelect = (tbl) => {
    setSql(`SELECT *\nFROM ${tbl}\nLIMIT 100;`);
    setSelectedTable(tbl);
    textareaRef.current?.focus();
  };

  /* ── Amazon Q: generate SQL from natural language ── */
  const generateSQL = useCallback(async () => {
    const p = aiPrompt.trim();
    if (!p || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    setAiModel('');
    try {
      const resp = await fetch(`${baseUrl}/athena/generate-sql`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ prompt: p, database }),
      });
      const data = await resp.json();
      if (!resp.ok || data.status === 'error') {
        setAiError(data.error || 'Generation failed');
      } else {
        setSql(data.sql);
        setAiModel(data.model || '');
        setAiPrompt('');
        textareaRef.current?.focus();
      }
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiLoading, database, baseUrl, hdrs]);

  const toggleExpand = (tbl) =>
    setExpanded((p) => ({ ...p, [tbl]: !p[tbl] }));

  if (!show) return null;

  const tables = Object.keys(schema).sort();

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <div style={S.overlay}>
      <div style={S.modal}>

        {/* ── Title Bar ── */}
        <div style={S.titleBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗄</span>
            <span style={S.titleText}>Athena SQL Client</span>
            <span style={S.titleSub}>Amazon Athena · us-east-1 · Glue Catalog</span>
          </div>
          <button onClick={onClose} style={S.closeBtn} title="Close">✕</button>
        </div>

        {/* ── Menu Bar ── */}
        <div style={S.menuBar}>
          <span style={S.menuItem}>File</span>
          <span style={S.menuItem}>Edit</span>
          <span style={S.menuItem}>Query</span>
          <span style={S.menuItem}>View</span>
        </div>

        {/* ── Toolbar ── */}
        <div style={S.toolbar}>
          {/* database selector */}
          <label style={S.toolLabel}>Database:</label>
          <select value={database} onChange={(e) => setDatabase(e.target.value)} style={S.dbSelect}>
            {databases.map((db) => <option key={db} value={db}>{db}</option>)}
            {!databases.includes(database) && <option value={database}>{database}</option>}
          </select>

          <div style={S.toolSep} />

          <button onClick={runQuery} disabled={running} style={S.runBtn} title="F5 or Ctrl+Enter">
            {running ? '⏳' : '▶'} {running ? 'Executing…' : 'Execute'}
          </button>

          <button
            onClick={() => { setSql(''); textareaRef.current?.focus(); }}
            style={S.toolBtn}
          >✕ Clear</button>

          {/* Examples dropdown */}
          <div style={{ position: 'relative' }} ref={examplesRef}>
            <button onClick={() => setShowExamples((p) => !p)} style={S.toolBtn}>
              📋 Templates ▾
            </button>
            {showExamples && (
              <div style={S.dropdown}>
                {EXAMPLES.map((ex) => (
                  <div
                    key={ex.label}
                    onClick={() => { setSql(ex.sql); setShowExamples(false); textareaRef.current?.focus(); }}
                    style={S.dropItem}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1e3a5f')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {ex.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={S.toolSep} />

          {/* status indicator */}
          <span style={S.statusDot(running)} />
          <span style={S.toolLabel}>
            {running ? 'Running…' : result ? `${result.count} row(s)` : 'Ready'}
          </span>
        </div>{/* toolbar */}

        {/* ── Natural Language Row ── */}
        <div style={S.aiBar}>
          <span style={S.aiPowered}>✦ Bedrock</span>
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Ask in plain English… e.g. 'show me the highest priced claim'"
            style={S.aiInput}
            disabled={aiLoading}
          />
          <button onClick={generateSQL} disabled={aiLoading || !aiPrompt.trim()} style={S.aiBtn}>
            {aiLoading ? '⏳ Generating…' : '🤖 Generate SQL'}
          </button>
          {aiError && <span style={S.aiErr}>❌ {aiError}</span>}
        </div>
        <div style={S.body}>

          {/* Object Explorer sidebar */}
          <div style={S.sidebar}>
            <div style={S.sidebarTitle}>Object Explorer</div>
            <div style={S.sidebarScroll}>

              {/* database node */}
              <div style={S.dbNode}>
                <span style={{ color: '#38bdf8', marginRight: 5 }}>🗄</span>
                <span style={S.dbNodeLabel}>{database}</span>
              </div>

              {/* Tables folder */}
              <div style={{ paddingLeft: 14 }}>
                <div style={S.folderNode}>
                  <span style={{ color: '#fbbf24', marginRight: 4 }}>📁</span>
                  <span style={S.folderLabel}>
                    Tables {loadingSchema ? '…' : `(${tables.length})`}
                  </span>
                </div>

                {/* table rows */}
                <div style={{ paddingLeft: 14 }}>
                  {tables.map((tbl) => (
                    <div key={tbl}>
                      {/* table row */}
                      <div
                        style={{
                          ...S.tableNode,
                          background: selectedTable === tbl ? '#1e3a5f' : 'transparent',
                        }}
                        onClick={() => toggleExpand(tbl)}
                        onDoubleClick={() => insertSelect(tbl)}
                        title="Double-click: SELECT * FROM this table"
                      >
                        <span style={{ color: '#64748b', fontSize: 9, width: 10, display: 'inline-block' }}>
                          {expanded[tbl] ? '▼' : '▶'}
                        </span>
                        <span style={{ color: '#7dd3fc', marginRight: 4 }}>📋</span>
                        <span style={S.tableLabel}>{tbl}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); insertSelect(tbl); }}
                          style={S.selectBtn}
                          title="Insert SELECT * FROM this table"
                        >SELECT</button>
                      </div>

                      {/* column rows */}
                      {expanded[tbl] && schema[tbl]?.map((col) => (
                        <div key={col.name} style={S.colNode}>
                          <span style={{ color: '#475569', fontSize: 9, marginRight: 4 }}>⬡</span>
                          <span style={S.colName}>{col.name}</span>
                          <span style={S.colType}>{col.type}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!loadingSchema && tables.length === 0 && (
                    <div style={{ color: '#475569', fontSize: 11, padding: '6px 4px' }}>No tables found</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Editor + Results */}
          <div style={S.rightPane}>

            {/* SQL Editor */}
            <div style={S.editorPane}>
              <div style={S.editorHeader}>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>
                  SQLQuery1.sql — {database}
                </span>
                <span style={{ color: '#475569', fontSize: 10 }}>
                  Ctrl+Enter to execute
                </span>
              </div>
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={handleKey}
                spellCheck={false}
                style={S.editor}
                placeholder="-- Type SQL here, or double-click a table in the Object Explorer"
              />
            </div>

            {/* Results area */}
            <div style={S.resultsPane}>
              {/* tab bar */}
              <div style={S.tabBar}>
                <div
                  onClick={() => setActiveTab('results')}
                  style={activeTab === 'results' ? S.tabActive : S.tabInactive}
                >
                  Results{result ? ` (${result.count})` : ''}
                </div>
                <div
                  onClick={() => setActiveTab('messages')}
                  style={activeTab === 'messages' ? S.tabActive : S.tabInactive}
                >
                  Messages
                </div>

                {/* stats bar + download */}
                {result && (
                  <div style={S.statsBar}>
                    <span style={S.statPill}>{result.count} rows</span>
                    <span style={S.statPill}>{fmtMs(result.elapsed_ms)}</span>
                    <span style={S.statPill}>{fmtBytes(result.scanned_bytes)} scanned</span>
                    <span style={S.statPill}>ID: {result.query_execution_id?.slice(0, 8)}…</span>
                    {result.columns.length > 0 && (
                      <button
                        onClick={() => downloadCSV(result.columns, result.rows,
                          `athena-${database}-${new Date().toISOString().slice(0,10)}.csv`)}
                        style={S.dlBtn}
                        title="Download results as CSV"
                      >
                        ⬇ CSV
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Results grid */}
              {activeTab === 'results' && (
                <div style={S.gridWrapper}>
                  {running && (
                    <div style={S.centerMsg}>⏳ Executing on Athena… please wait</div>
                  )}
                  {!running && !result && !queryError && (
                    <div style={S.centerMsg}>Run a query to see results here</div>
                  )}
                  {!running && result && result.columns.length === 0 && (
                    <div style={S.centerMsg}>Query completed — no rows returned</div>
                  )}
                  {!running && result && result.columns.length > 0 && (
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={{ ...S.th, color: '#64748b', width: 40, textAlign: 'center' }}>#</th>
                          {result.columns.map((col) => (
                            <th key={col} style={S.th}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr
                            key={i}
                            style={{ background: i % 2 === 0 ? '#0f172a' : '#111827' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#1e3a5f')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? '#0f172a' : '#111827')}
                          >
                            <td style={{ ...S.td, color: '#374151', textAlign: 'center', userSelect: 'none' }}>{i + 1}</td>
                            {result.columns.map((col) => (
                              <td key={col} style={S.td}>{row[col] ?? <span style={{ color: '#374151' }}>NULL</span>}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Messages tab */}
              {activeTab === 'messages' && (
                <div style={S.messagesPane}>
                  {queryError && (
                    <div style={S.msgError}>
                      <span style={{ fontSize: 14 }}>❌</span>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Query Failed</div>
                        <pre style={S.msgPre}>{queryError}</pre>
                      </div>
                    </div>
                  )}
                  {result && (
                    <div style={S.msgSuccess}>
                      <span style={{ fontSize: 14 }}>✅</span>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Query completed successfully</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
                          <div>Rows returned: <strong style={{ color: '#e2e8f0' }}>{result.count}</strong></div>
                          <div>Execution time: <strong style={{ color: '#e2e8f0' }}>{fmtMs(result.elapsed_ms)}</strong></div>
                          <div>Data scanned: <strong style={{ color: '#e2e8f0' }}>{fmtBytes(result.scanned_bytes)}</strong></div>
                          <div>Database: <strong style={{ color: '#e2e8f0' }}>{result.database}</strong></div>
                          <div>Query ID: <code style={{ color: '#7dd3fc' }}>{result.query_execution_id}</code></div>
                          <div>Results at: <code style={{ color: '#7dd3fc' }}>{result.output_location}</code></div>
                        </div>
                      </div>
                    </div>
                  )}
                  {!queryError && !result && (
                    <div style={{ padding: 20, color: '#475569', fontSize: 12 }}>No messages.</div>
                  )}
                </div>
              )}
            </div>

          </div>{/* rightPane */}
        </div>{/* body */}

        {/* ── Status Bar ── */}
        <div style={S.statusBar}>
          <span>Amazon Athena</span>
          <span style={S.statusSep}>|</span>
          <span>Glue Catalog</span>
          <span style={S.statusSep}>|</span>
          <span style={{ color: running ? '#fbbf24' : '#4ade80' }}>
            {running ? 'Executing' : 'Ready'}
          </span>
          {result && (
            <>
              <span style={S.statusSep}>|</span>
              <span>{result.count} rows</span>
              <span style={S.statusSep}>|</span>
              <span>{fmtMs(result.elapsed_ms)}</span>
            </>
          )}
          <span style={{ marginLeft: 'auto', color: '#475569' }}>
            Workgroup: primary · Output: s3://dgs-glue-staging/athena-results/
          </span>
        </div>

      </div>{/* modal */}
    </div>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────── */
const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
  },
  modal: {
    background: '#0d1117',
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    color: '#e2e8f0',
    overflow: 'hidden',
  },

  /* title bar */
  titleBar: {
    background: 'linear-gradient(135deg, #1e3a5f, #1a237e)',
    padding: '7px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid #2563eb',
    flexShrink: 0,
  },
  titleText: { fontWeight: 700, fontSize: 14, color: '#e2e8f0', letterSpacing: 0.3 },
  titleSub: { fontSize: 11, color: '#7dd3fc', marginLeft: 12 },
  closeBtn: {
    background: 'transparent', border: 'none', color: '#94a3b8',
    fontSize: 16, cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
    transition: 'color .15s',
  },

  /* menu bar */
  menuBar: {
    background: '#161b22',
    padding: '3px 10px',
    display: 'flex', gap: 0,
    borderBottom: '1px solid #21262d',
    flexShrink: 0,
  },
  menuItem: {
    fontSize: 12, color: '#94a3b8', padding: '2px 10px', cursor: 'default',
    borderRadius: 3,
  },

  /* toolbar */
  toolbar: {
    background: '#161b22',
    padding: '5px 10px',
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    borderBottom: '1px solid #21262d',
    flexShrink: 0,
  },
  toolLabel: { fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' },
  toolSep: { width: 1, height: 20, background: '#21262d', margin: '0 4px' },
  dbSelect: {
    background: '#0d1117', border: '1px solid #30363d', color: '#e2e8f0',
    borderRadius: 4, padding: '3px 8px', fontSize: 12, minWidth: 200,
  },
  runBtn: {
    background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
    color: '#fff', border: 'none', borderRadius: 4,
    padding: '4px 16px', fontWeight: 700, fontSize: 12,
    cursor: 'pointer', letterSpacing: 0.3,
  },
  toolBtn: {
    background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9',
    borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, zIndex: 100,
    background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
    minWidth: 200, marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  dropItem: {
    padding: '7px 14px', fontSize: 12, cursor: 'pointer',
    color: '#c9d1d9', borderBottom: '1px solid #21262d',
    transition: 'background .1s',
  },
  statusDot: (active) => ({
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: active ? '#fbbf24' : '#4ade80',
    boxShadow: active ? '0 0 6px #fbbf24' : '0 0 6px #4ade80',
  }),

  /* body */
  body: {
    display: 'flex', flex: 1, overflow: 'hidden',
  },

  /* sidebar */
  sidebar: {
    width: 240, minWidth: 200, maxWidth: 300,
    background: '#161b22',
    borderRight: '1px solid #21262d',
    display: 'flex', flexDirection: 'column',
    flexShrink: 0,
  },
  sidebarTitle: {
    padding: '8px 12px', fontSize: 11, fontWeight: 700,
    color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1,
    background: '#0d1117', borderBottom: '1px solid #21262d',
  },
  sidebarScroll: { overflowY: 'auto', flex: 1, paddingBottom: 20 },
  dbNode: {
    display: 'flex', alignItems: 'center', padding: '8px 12px',
    background: '#0d1117',
  },
  dbNodeLabel: { fontSize: 12, color: '#58a6ff', fontWeight: 700 },
  folderNode: {
    display: 'flex', alignItems: 'center',
    padding: '5px 4px',
  },
  folderLabel: { fontSize: 11, color: '#8b949e', fontWeight: 600 },
  tableNode: {
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '4px 4px', cursor: 'pointer', borderRadius: 3,
    transition: 'background .1s',
  },
  tableLabel: { fontSize: 11, color: '#c9d1d9', flex: 1 },
  selectBtn: {
    background: '#1e3a5f', border: 'none', color: '#7dd3fc',
    fontSize: 9, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
    opacity: 0, transition: 'opacity .15s',
  },
  colNode: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 4px 2px 20px',
  },
  colName: { fontSize: 10, color: '#8b949e', flex: 1 },
  colType: { fontSize: 9, color: '#30363d', background: '#21262d', padding: '0 4px', borderRadius: 3 },

  /* right pane */
  rightPane: {
    display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
  },
  editorPane: {
    display: 'flex', flexDirection: 'column',
    height: '40%', minHeight: 120, borderBottom: '1px solid #21262d',
  },
  editorHeader: {
    background: '#161b22', padding: '4px 12px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid #21262d', flexShrink: 0,
  },
  editor: {
    flex: 1, background: '#0d1117', color: '#e2e8f0',
    border: 'none', outline: 'none', resize: 'none',
    fontFamily: '"Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
    fontSize: 13, lineHeight: 1.6,
    padding: '12px 16px', tabSize: 4,
  },

  /* results */
  resultsPane: {
    display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
  },
  tabBar: {
    background: '#161b22', display: 'flex', alignItems: 'center',
    borderBottom: '1px solid #21262d', flexShrink: 0,
  },
  tabActive: {
    padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
    color: '#58a6ff', borderBottom: '2px solid #2563eb',
    background: '#0d1117',
  },
  tabInactive: {
    padding: '6px 16px', fontSize: 12, cursor: 'pointer',
    color: '#8b949e', borderBottom: '2px solid transparent',
  },
  statsBar: {
    marginLeft: 'auto', display: 'flex', gap: 6, paddingRight: 12,
  },
  statPill: {
    background: '#21262d', color: '#8b949e', borderRadius: 10,
    padding: '2px 8px', fontSize: 10, border: '1px solid #30363d',
  },
  dlBtn: {
    background: 'linear-gradient(135deg,#064e3b,#065f46)',
    color: '#6ee7b7', border: '1px solid #065f46',
    borderRadius: 10, padding: '2px 10px', fontSize: 10,
    cursor: 'pointer', fontWeight: 700, letterSpacing: 0.3,
    marginLeft: 4,
  },

  /* AI bar */
  aiBar: {
    background: 'linear-gradient(135deg, #0d1b2a, #0f1e35)',
    borderBottom: '1px solid #1e3a5f',
    padding: '8px 12px',
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  aiLabel: { fontSize: 16, flexShrink: 0 },
  aiInput: {
    flex: 1, background: '#0d1117', border: '1px solid #2563eb',
    color: '#e2e8f0', borderRadius: 6, padding: '6px 12px',
    fontSize: 13, outline: 'none',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  },
  aiBtn: {
    background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
    color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 16px', fontWeight: 700, fontSize: 12,
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  },
  aiPowered: {
    fontSize: 13, color: '#7dd3fc', whiteSpace: 'nowrap', flexShrink: 0,
    fontWeight: 500,
  },
  aiErr: {
    fontSize: 11, color: '#f87171', flexShrink: 0, maxWidth: 300,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },

  gridWrapper: {
    overflowX: 'auto', overflowY: 'auto', flex: 1,
  },
  centerMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 120, color: '#475569', fontSize: 13,
  },
  table: {
    borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 12,
  },
  th: {
    background: '#161b22', color: '#8b949e',
    padding: '7px 14px', textAlign: 'left', fontWeight: 700,
    borderBottom: '1px solid #21262d', borderRight: '1px solid #21262d',
    whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1,
    letterSpacing: 0.3, textTransform: 'uppercase', fontSize: 10,
  },
  td: {
    padding: '5px 14px', color: '#c9d1d9', fontSize: 12,
    borderBottom: '1px solid #161b22', borderRight: '1px solid #161b22',
    whiteSpace: 'nowrap', maxWidth: 320,
    overflow: 'hidden', textOverflow: 'ellipsis',
  },

  messagesPane: {
    padding: 16, overflowY: 'auto', flex: 1, fontFamily: 'Consolas, monospace',
  },
  msgError: {
    display: 'flex', gap: 12, background: '#1a0808', border: '1px solid #7f1d1d',
    borderRadius: 6, padding: '12px 16px', color: '#f87171',
  },
  msgSuccess: {
    display: 'flex', gap: 12, background: '#071a0e', border: '1px solid #14532d',
    borderRadius: 6, padding: '12px 16px', color: '#4ade80',
  },
  msgPre: {
    margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    color: '#fca5a5',
  },

  /* status bar */
  statusBar: {
    background: '#1d4ed8', padding: '3px 12px',
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 11, color: '#bfdbfe',
    borderTop: '1px solid #2563eb', flexShrink: 0,
  },
  statusSep: { color: '#3b82f6' },
};
