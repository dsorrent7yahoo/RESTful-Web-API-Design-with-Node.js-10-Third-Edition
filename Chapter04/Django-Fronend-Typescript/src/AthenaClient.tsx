import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';

interface AthenaExample {
  label: string;
  sql: string;
}

interface SchemaColumn {
  name: string;
  type: string;
}

interface AthenaResult {
  count: number;
  columns: string[];
  rows: Record<string, unknown>[];
  stats?: {
    executionTimeMs?: number;
    dataScannedBytes?: number;
  };
  [key: string]: unknown;
}

interface AthenaClientProps {
  show: boolean;
  onClose: () => void;
  baseUrl: string;
  authToken: string;
}

const EXAMPLES: AthenaExample[] = [
  { label: 'Preview first 10 rows',  sql: 'SELECT *\nFROM claims_clean\nLIMIT 10;' },
  { label: 'Total row count',         sql: 'SELECT COUNT(*) AS total_rows\nFROM claims_clean;' },
  { label: 'Claims by status',        sql: 'SELECT status,\n       COUNT(*) AS claims,\n       ROUND(SUM(total_amount), 2) AS total_billed\nFROM claims_clean\nGROUP BY status\nORDER BY claims DESC;' },
  { label: 'Claims by service date',  sql: 'SELECT service_date,\n       COUNT(*) AS claims,\n       ROUND(SUM(total_amount), 2) AS total_billed\nFROM claims_clean\nGROUP BY service_date\nORDER BY service_date DESC\nLIMIT 30;' },
  { label: 'Payer distribution',      sql: 'SELECT payer_name,\n       COUNT(*) AS claims,\n       ROUND(AVG(total_amount), 2) AS avg_amount\nFROM claims_clean\nGROUP BY payer_name\nORDER BY claims DESC;' },
  { label: 'Top 10 patients by spend',sql: 'SELECT patient_id,\n       COUNT(*) AS claims,\n       ROUND(SUM(total_amount), 2) AS total_spend\nFROM claims_clean\nGROUP BY patient_id\nORDER BY total_spend DESC\nLIMIT 10;' },
  { label: 'Encounter class breakdown',sql: 'SELECT encounter_class,\n       COUNT(*) AS claims\nFROM claims_clean\nGROUP BY encounter_class\nORDER BY claims DESC;' },
];

const fmtBytes = (b: number) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
};

const fmtMs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

const downloadCSV = (columns: string[], rows: Record<string, unknown>[], filename = 'athena-results.csv') => {
  const escape = (v: unknown) => {
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

/* ── styles ────────────────────────────────────────────────────────────── */
const S = {
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1100, display: 'flex', alignItems: 'stretch', justifyContent: 'center' },
  modal:       { background: '#0d1117', display: 'flex', flexDirection: 'column' as const, width: '100%', maxWidth: '1280px', maxHeight: '100vh', fontFamily: 'Consolas,"Courier New",monospace', color: '#c9d1d9', fontSize: 13 },
  titleBar:    { background: '#161b22', borderBottom: '1px solid #30363d', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  titleText:   { fontWeight: 700, fontSize: 15, color: '#e6edf3' },
  titleSub:    { fontSize: 11, color: '#8b949e', marginLeft: 10 },
  closeBtn:    { background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
  menuBar:     { background: '#161b22', borderBottom: '1px solid #30363d', padding: '3px 14px', display: 'flex', gap: 20 },
  menuItem:    { color: '#c9d1d9', fontSize: 12, cursor: 'pointer', padding: '2px 6px', borderRadius: 3 },
  toolbar:     { background: '#1c2128', borderBottom: '1px solid #30363d', padding: '6px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  toolLabel:   { color: '#8b949e', fontSize: 12 },
  dbSelect:    { background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, padding: '3px 8px', fontSize: 12 },
  toolSep:     { width: 1, height: 20, background: '#30363d', margin: '0 4px' },
  runBtn:      { background: 'linear-gradient(135deg,#238636,#196127)', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  toolBtn:     { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' },
  dropdown:    { position: 'absolute' as const, top: '110%', left: 0, background: '#161b22', border: '1px solid #30363d', borderRadius: 6, zIndex: 200, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '4px 0' },
  dropItem:    { padding: '7px 14px', fontSize: 12, color: '#c9d1d9', cursor: 'pointer' },
  statusDot:   (running: boolean) => ({ width: 8, height: 8, borderRadius: '50%', background: running ? '#3fb950' : '#484f58', display: 'inline-block' }),
  aiBar:       { background: '#131921', borderBottom: '1px solid #1f2937', padding: '6px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  aiPowered:   { fontSize: 11, color: '#7ee787', fontWeight: 700, whiteSpace: 'nowrap' as const, background: '#1a2e1a', border: '1px solid #2d5e2d', borderRadius: 4, padding: '2px 8px' },
  aiInput:     { flex: 1, background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 5, padding: '5px 10px', fontSize: 12, minWidth: 0 },
  aiBtn:       { background: 'linear-gradient(135deg,#6e40c9,#553098)', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  aiErr:       { color: '#f85149', fontSize: 11 },
  body:        { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  sidebar:     { width: 220, background: '#161b22', borderRight: '1px solid #30363d', display: 'flex', flexDirection: 'column' as const, flexShrink: 0 },
  sidebarTitle:{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8b949e', borderBottom: '1px solid #30363d' },
  sidebarScroll:{ flex: 1, overflowY: 'auto' as const, padding: '6px 0' },
  dbNode:      { display: 'flex', alignItems: 'center', padding: '5px 12px', fontSize: 12 },
  dbNodeLabel: { color: '#79c0ff', fontWeight: 700 },
  folderNode:  { display: 'flex', alignItems: 'center', padding: '4px 12px', fontSize: 12 },
  folderLabel: { color: '#c9d1d9' },
  tableNode:   { display: 'flex', alignItems: 'center', padding: '3px 4px 3px 2px', fontSize: 12, cursor: 'pointer', borderRadius: 3, gap: 2 } as JSX.CSSProperties,
  tableLabel:  { flex: 1, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  selectBtn:   { background: '#1f6feb22', border: '1px solid #1f6feb44', color: '#79c0ff', borderRadius: 3, padding: '1px 6px', fontSize: 10, cursor: 'pointer', flexShrink: 0 as const, marginLeft: 2 } as JSX.CSSProperties,
  colNode:     { display: 'flex', alignItems: 'center', padding: '2px 4px 2px 18px', fontSize: 11, gap: 4 } as JSX.CSSProperties,
  colName:     { color: '#e6edf3' },
  colType:     { color: '#8b949e', fontSize: 10 },
  rightPane:   { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, overflow: 'hidden' },
  editorPane:  { borderBottom: '1px solid #30363d', display: 'flex', flexDirection: 'column' as const, height: 200 },
  editorHeader:{ background: '#1c2128', padding: '4px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: '1px solid #30363d' },
  editor:      { flex: 1, background: '#0d1117', color: '#c9d1d9', border: 'none', padding: '10px 12px', fontFamily: 'Consolas,"Courier New",monospace', fontSize: 13, resize: 'none' as const, outline: 'none' },
  resultsPane: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, overflow: 'hidden' },
  tabBar:      { background: '#161b22', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 0 },
  tabActive:   { padding: '7px 16px', fontSize: 12, color: '#f0f6fc', borderBottom: '2px solid #1f6feb', cursor: 'pointer', fontWeight: 700, background: 'none', border: 'none' } as JSX.CSSProperties,
  tabInactive: { padding: '7px 16px', fontSize: 12, color: '#8b949e', borderBottom: '2px solid transparent', cursor: 'pointer', background: 'none', border: 'none' } as JSX.CSSProperties,
  tableWrap:   { flex: 1, overflow: 'auto' },
  th:          { background: '#161b22', color: '#8b949e', padding: '6px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, borderBottom: '1px solid #30363d', position: 'sticky' as const, top: 0, whiteSpace: 'nowrap' as const },
  td:          { padding: '5px 10px', fontSize: 12, color: '#c9d1d9', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' as const },
  msgPane:     { flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 8 },
};

export default function AthenaClient({ show, onClose, baseUrl, authToken }: AthenaClientProps) {
  const [database,      setDatabase]      = useState('fhir-table-db');
  const [databases,     setDatabases]     = useState<string[]>([]);
  const [schema,        setSchema]        = useState<Record<string, SchemaColumn[]>>({});
  const [expanded,      setExpanded]      = useState<Record<string, boolean>>({});
  const [sql,           setSql]           = useState('SELECT *\nFROM claims_clean\nLIMIT 10;');
  const [running,       setRunning]       = useState(false);
  const [result,        setResult]        = useState<AthenaResult | null>(null);
  const [queryError,    setQueryError]    = useState('');
  const [activeTab,     setActiveTab]     = useState('results');
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [showExamples,  setShowExamples]  = useState(false);
  const [selectedTable, setSelectedTable] = useState('');
  const [aiPrompt,      setAiPrompt]      = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiError,       setAiError]       = useState('');
  const [aiModel,       setAiModel]       = useState('');

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const examplesRef  = useRef<HTMLDivElement>(null);

  const hdrs = useCallback(
    () => ({ Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }),
    [authToken],
  );

  useEffect(() => {
    if (!show || !authToken) return;
    fetch(`${baseUrl}/athena/databases`, { headers: hdrs() })
      .then((r) => r.json())
      .then((d: { databases?: string[] }) => setDatabases(d.databases ?? []))
      .catch(() => {});
  }, [show, authToken, baseUrl, hdrs]);

  useEffect(() => {
    if (!show || !authToken || !database) return;
    setLoadingSchema(true);
    setSchema({});
    setExpanded({});
    fetch(`${baseUrl}/athena/schema?database=${encodeURIComponent(database)}`, { headers: hdrs() })
      .then((r) => r.json())
      .then((d: { schema?: Record<string, SchemaColumn[]> }) => setSchema(d.schema ?? {}))
      .catch(() => {})
      .finally(() => setLoadingSchema(false));
  }, [show, authToken, database, baseUrl, hdrs]);

  useEffect(() => {
    if (!showExamples) return;
    const handler = (e: MouseEvent) => {
      if (examplesRef.current && !examplesRef.current.contains(e.target as Node))
        setShowExamples(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExamples]);

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
      const data: AthenaResult & { status?: string; error?: string } = await resp.json();
      if (!resp.ok || data.status === 'error') {
        setQueryError(data.error ?? `HTTP ${resp.status}`);
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

  const handleKey = (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      runQuery();
    }
  };

  const insertSelect = (tbl: string) => {
    setSql(`SELECT *\nFROM ${tbl}\nLIMIT 100;`);
    setSelectedTable(tbl);
    textareaRef.current?.focus();
  };

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
      const data: { status?: string; error?: string; sql?: string; model?: string } = await resp.json();
      if (!resp.ok || data.status === 'error') {
        setAiError(data.error ?? 'Generation failed');
      } else {
        setSql(data.sql ?? '');
        setAiModel(data.model ?? '');
        setAiPrompt('');
        textareaRef.current?.focus();
      }
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiLoading, database, baseUrl, hdrs]);

  const toggleExpand = (tbl: string) =>
    setExpanded((p) => ({ ...p, [tbl]: !p[tbl] }));

  if (!show) return null;

  const tables = Object.keys(schema).sort();
  const columns = result?.columns ?? [];
  const rows    = result?.rows    ?? [];

  return (
    <div style={S.overlay}>
      <div style={S.modal}>

        {/* Title Bar */}
        <div style={S.titleBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗄</span>
            <span style={S.titleText}>Athena SQL Client</span>
            <span style={S.titleSub}>Amazon Athena · us-east-1 · Glue Catalog</span>
          </div>
          <button onClick={onClose} style={S.closeBtn} title="Close">✕</button>
        </div>

        {/* Menu Bar */}
        <div style={S.menuBar}>
          {['File','Edit','Query','View'].map((m) => (
            <span key={m} style={S.menuItem}>{m}</span>
          ))}
        </div>

        {/* Toolbar */}
        <div style={S.toolbar}>
          <label style={S.toolLabel}>Database:</label>
          <select value={database} onChange={(e) => setDatabase(e.currentTarget.value)} style={S.dbSelect}>
            {databases.map((db) => <option key={db} value={db}>{db}</option>)}
            {!databases.includes(database) && <option value={database}>{database}</option>}
          </select>
          <div style={S.toolSep} />
          <button onClick={runQuery} disabled={running} style={S.runBtn} title="F5 or Ctrl+Enter">
            {running ? '⏳' : '▶'} {running ? 'Executing…' : 'Execute'}
          </button>
          <button onClick={() => { setSql(''); textareaRef.current?.focus(); }} style={S.toolBtn}>✕ Clear</button>
          <div style={{ position: 'relative' }} ref={examplesRef}>
            <button onClick={() => setShowExamples((p) => !p)} style={S.toolBtn}>📋 Templates ▾</button>
            {showExamples && (
              <div style={S.dropdown}>
                {EXAMPLES.map((ex) => (
                  <div key={ex.label}
                    onClick={() => { setSql(ex.sql); setShowExamples(false); textareaRef.current?.focus(); }}
                    style={S.dropItem}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1e3a5f'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                    {ex.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={S.toolSep} />
          <span style={S.statusDot(running)} />
          <span style={S.toolLabel}>
            {running ? 'Running…' : result ? `${result.count} row(s)` : 'Ready'}
          </span>
        </div>

        {/* AI Bar */}
        <div style={S.aiBar}>
          <span style={S.aiPowered}>✦ Bedrock</span>
          <input value={aiPrompt} onChange={(e) => setAiPrompt(e.currentTarget.value)}
            placeholder="Ask in plain English… e.g. 'show me the highest priced claim'"
            style={S.aiInput} disabled={aiLoading} />
          <button onClick={generateSQL} disabled={aiLoading || !aiPrompt.trim()} style={S.aiBtn}>
            {aiLoading ? '⏳ Generating…' : '🤖 Generate SQL'}
          </button>
          {aiModel && <span style={{ fontSize: 11, color: '#8b949e' }}>model: {aiModel}</span>}
          {aiError && <span style={S.aiErr}>❌ {aiError}</span>}
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* Sidebar */}
          <div style={S.sidebar}>
            <div style={S.sidebarTitle}>Object Explorer</div>
            <div style={S.sidebarScroll}>
              <div style={S.dbNode}>
                <span style={{ color: '#38bdf8', marginRight: 5 }}>🗄</span>
                <span style={S.dbNodeLabel}>{database}</span>
              </div>
              <div style={{ paddingLeft: 14 }}>
                <div style={S.folderNode}>
                  <span style={{ color: '#fbbf24', marginRight: 4 }}>📁</span>
                  <span style={S.folderLabel}>Tables {loadingSchema ? '…' : `(${tables.length})`}</span>
                </div>
                <div style={{ paddingLeft: 14 }}>
                  {tables.map((tbl) => (
                    <div key={tbl}>
                      <div style={{ ...S.tableNode, background: selectedTable === tbl ? '#1e3a5f' : 'transparent' }}
                        onClick={() => toggleExpand(tbl)} onDblClick={() => insertSelect(tbl)}>
                        <span style={{ color: '#64748b', fontSize: 9, width: 10, display: 'inline-block' }}>
                          {expanded[tbl] ? '▼' : '▶'}
                        </span>
                        <span style={{ color: '#7dd3fc', marginRight: 4 }}>📋</span>
                        <span style={S.tableLabel}>{tbl}</span>
                        <button onClick={(e) => { e.stopPropagation(); insertSelect(tbl); }}
                          style={S.selectBtn}>SELECT</button>
                      </div>
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

          {/* Right pane */}
          <div style={S.rightPane}>
            <div style={S.editorPane}>
              <div style={S.editorHeader}>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>SQLQuery1.sql — {database}</span>
                <span style={{ color: '#475569', fontSize: 10 }}>Ctrl+Enter to execute</span>
              </div>
              <textarea ref={textareaRef} value={sql}
                onChange={(e) => setSql(e.currentTarget.value)}
                onKeyDown={handleKey}
                spellcheck={false} style={S.editor}
                placeholder="-- Type SQL here, or double-click a table in the Object Explorer" />
            </div>

            <div style={S.resultsPane}>
              <div style={S.tabBar}>
                <div onClick={() => setActiveTab('results')} style={activeTab === 'results' ? S.tabActive : S.tabInactive}>
                  Results{result ? ` (${result.count})` : ''}
                </div>
                <div onClick={() => setActiveTab('messages')} style={activeTab === 'messages' ? S.tabActive : S.tabInactive}>
                  Messages
                </div>
                {result?.stats && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center', paddingRight: 12 }}>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>
                      ⏱ {fmtMs(result.stats.executionTimeMs ?? 0)}
                    </span>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>
                      📦 {fmtBytes(result.stats.dataScannedBytes ?? 0)} scanned
                    </span>
                    {columns.length > 0 && (
                      <button onClick={() => downloadCSV(columns, rows)}
                        style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9',
                          borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                        ⬇ CSV
                      </button>
                    )}
                  </div>
                )}
              </div>

              {activeTab === 'results' && (
                <div style={S.tableWrap}>
                  {rows.length === 0 && !running ? (
                    <div style={{ padding: 20, color: '#8b949e', fontSize: 12 }}>
                      {result ? 'Query returned 0 rows.' : 'Run a query to see results here.'}
                    </div>
                  ) : (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          {columns.map((c) => <th key={c} style={S.th}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, ri) => (
                          <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : '#161b22' }}>
                            {columns.map((c) => (
                              <td key={c} style={S.td}>{String(row[c] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'messages' && (
                <div style={S.msgPane}>
                  {queryError ? (
                    <div style={{ background: '#1a0d0d', border: '1px solid #f85149', borderRadius: 6,
                      padding: '10px 14px', color: '#f85149', fontSize: 12 }}>
                      ❌ {queryError}
                    </div>
                  ) : (
                    <div style={{ color: '#8b949e', fontSize: 12 }}>
                      {result ? `✅ Query completed — ${result.count} row(s) returned.` : 'No messages.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
