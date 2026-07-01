import React, { useState, useCallback } from 'react';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const fmtBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
};

const downloadCSV = (rows, filename = 'data.csv') => {
  if (!rows || !rows.length) return;
  const cols  = Object.keys(rows[0]);
  const esc   = (v) => { const s = v == null ? '' : String(v); return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(esc).join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))];
  const blob  = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url   = URL.createObjectURL(blob);
  const a     = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
};

/* ─── component ───────────────────────────────────────────────────────────── */
export default function PatientsEncounters({ show, onClose, baseUrl, authToken }) {
  const [activeTab, setActiveTab]     = useState('patients');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState('');
  const [total, setTotal]             = useState(100);
  const [patientFiles, setPatientFiles] = useState([]);
  const [encounterFiles, setEncounterFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const api = useCallback(async (path, opts = {}) => {
    const url = `${(baseUrl || 'http://localhost:4015').replace(/\/$/, '')}${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || data.error || `HTTP ${resp.status}`);
    return data;
  }, [baseUrl, authToken]);

  const generate = useCallback(async (resource) => {
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api(`/${resource}/generate`, {
        method: 'POST',
        body: JSON.stringify({ total }),
      });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, total]);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true); setError('');
    try {
      const [pf, ef] = await Promise.all([
        api('/patients/files'),
        api('/encounters/files'),
      ]);
      setPatientFiles(pf.files || []);
      setEncounterFiles(ef.files || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setFilesLoading(false);
    }
  }, [api]);

  if (!show) return null;

  const TABS = [
    { id: 'patients',   label: '👤 Patients' },
    { id: 'encounters', label: '🏥 Encounters' },
    { id: 'files',      label: '📁 S3 Files' },
  ];

  const panelStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  };
  const boxStyle = {
    background: '#1e1e2e', border: '1px solid #4c1d95', borderRadius: '12px',
    width: '860px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex',
    flexDirection: 'column', color: '#e2e8f0', fontFamily: 'monospace',
  };
  const tabStyle = (active) => ({
    padding: '8px 20px', cursor: 'pointer', borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
    background: 'none', border: 'none', borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
    color: active ? '#c4b5fd' : '#94a3b8', fontWeight: active ? 700 : 400, fontSize: '13px',
  });
  const btnStyle = (color = '#7c3aed') => ({
    background: color, color: '#fff', border: 'none', borderRadius: '6px',
    padding: '6px 16px', fontWeight: 700, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
  });

  const renderGenerate = (resource, label) => (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
        Generates synthetic FHIR R4 <strong style={{ color: '#c4b5fd' }}>{label}</strong> records,
        uploads CSV to S3 (<code>s3://dgs-glue-staging/{resource}s/</code>), and registers the
        Glue table <code>{resource}s</code> in <code>fhir-table-db</code>.
      </p>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <label style={{ fontSize: '13px', color: '#94a3b8' }}>Records to generate:</label>
        <input
          type="number" min={1} max={10000} value={total}
          onChange={e => setTotal(Math.max(1, parseInt(e.target.value) || 100))}
          style={{ width: '90px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #4c1d95',
            background: '#0f172a', color: '#e2e8f0', fontSize: '13px' }}
        />
        <button disabled={loading || !authToken} onClick={() => generate(resource)} style={btnStyle()}>
          {loading ? '⏳ Generating…' : `🧬 Generate ${label}s`}
        </button>
      </div>
      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #b91c1c', borderRadius: '6px', padding: '10px 14px', color: '#fca5a5', fontSize: '13px' }}>
          ❌ {error}
        </div>
      )}
      {result && (
        <div style={{ background: '#0f172a', border: '1px solid #4c1d95', borderRadius: '8px', padding: '14px' }}>
          <div style={{ display: 'flex', gap: '24px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#6ee7b7' }}>✅ Generated {result.total ?? result.rows ?? '?'} records</span>
            {result.key && <span style={{ fontSize: '12px', color: '#94a3b8' }}>📦 {result.key}</span>}
            {result.glue_action && <span style={{ fontSize: '12px', color: '#93c5fd' }}>🗄️ Glue table <strong>{result.table}</strong> {result.glue_action}</span>}
          </div>
          <pre style={{ fontSize: '11px', color: '#c4b5fd', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto', margin: 0 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );

  const renderFiles = () => (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <button onClick={loadFiles} disabled={filesLoading || !authToken}
        style={btnStyle('#0f766e')}>
        {filesLoading ? '⏳ Loading…' : '🔄 Refresh Files'}
      </button>
      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #b91c1c', borderRadius: '6px', padding: '10px 14px', color: '#fca5a5', fontSize: '13px' }}>
          ❌ {error}
        </div>
      )}
      {[{ label: 'Patient Files', files: patientFiles, prefix: 'patients/' },
        { label: 'Encounter Files', files: encounterFiles, prefix: 'encounters/' }
      ].map(({ label, files, prefix }) => (
        <div key={prefix}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#c4b5fd', marginBottom: '8px' }}>
            📁 {label} ({files.length})
          </div>
          {files.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>No files yet — click Generate first.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflow: 'auto' }}>
              {files.map(f => (
                <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px',
                  background: '#0f172a', borderRadius: '4px', padding: '5px 10px' }}>
                  <span style={{ color: '#93c5fd' }}>{f.key.replace(prefix, '')}</span>
                  <span style={{ color: '#94a3b8' }}>{fmtBytes(f.size)} · {f.lastModified?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={panelStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={boxStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #4c1d95' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '17px', color: '#c4b5fd' }}>🧬 Patients &amp; Encounters</h2>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>{baseUrl || 'http://localhost:4015'}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '22px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #2d1b69', padding: '0 8px' }}>
          {TABS.map(t => (
            <button key={t.id} style={tabStyle(activeTab === t.id)} onClick={() => { setActiveTab(t.id); setResult(null); setError(''); }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {activeTab === 'patients'   && renderGenerate('patients', 'Patient')}
          {activeTab === 'encounters' && renderGenerate('encounters', 'Encounter')}
          {activeTab === 'files'      && renderFiles()}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid #2d1b69', fontSize: '11px', color: '#475569',
          display: 'flex', justifyContent: 'space-between' }}>
          <span>Microservice port 4015 · FastAPI + boto3</span>
          <span>S3: dgs-glue-staging · Glue DB: fhir-table-db</span>
        </div>
      </div>
    </div>
  );
}
