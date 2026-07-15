import { useState, useEffect, useCallback } from 'react';
import './styles.css';
import OnSubmitWorkflow from './onSubmitWorkflow';

const TOKEN_KEY = 'healthCareToken';
const HOST = window.location.hostname;
const LANDING = HOST === 'localhost' ? 'http://localhost:5180' : `http://${HOST}`;

const BACKEND_PRESETS = {
  aws:     `http://${HOST}:8080/proxy/springboot`,
  cmdline: 'http://localhost:4004',
};

const MICROSERVICE_URLS = {
  glueCatalog:        `http://${HOST}:8080/proxy/glue`,
  claimsGenerator:    `http://${HOST}:8080/proxy/claims`,
  claimsCleaner:      `http://${HOST}:8080/proxy/cleaner`,
  sqsMonitor:         `http://${HOST}:8080/proxy/sqs`,
  athenaClient:       `http://${HOST}:8080/proxy/athena`,
  patientsEncounters: `http://${HOST}:8080/proxy/patients`,
};

const EXPLORER_PRESETS = [
  { label: '/medications/', method: 'GET',  path: '/medications/?limit=50' },
  { label: '/tables',       method: 'GET',  path: '/tables' },
  { label: '/health',       method: 'GET',  path: '/health' },
  { label: '/sqs/stats',    method: 'GET',  path: '/sqs/stats' },
  { label: '/claims/files', method: 'GET',  path: '/claims/files' },
];

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return null; }
}
function getToken()   { return localStorage.getItem(TOKEN_KEY); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }
function isLoggedIn() { const t=getToken(); if(!t) return false; const p=decodeJwt(t); return p ? p.exp*1000>Date.now() : false; }

// SSO bootstrap — must run before React renders
const ssoParam = new URLSearchParams(window.location.search).get('sso');
if (ssoParam) localStorage.setItem(TOKEN_KEY, ssoParam);
if (!isLoggedIn()) { window.location.href = LANDING; }

async function apiFetch(url, opts = {}) {
  const token = getToken();
  const res = await fetch(url, { ...opts, headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(opts.headers||{}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || res.statusText), { status: res.status });
  return data;
}

// ─── StatusDot ────────────────────────────────────────────────────────────────
function StatusDot({ online }) {
  return (
    <span className={`status-dot ${online ? 'online' : online===false ? 'offline' : 'checking'}`}>
      {online ? '● Online' : online===false ? '○ Offline' : '◌ Checking'}
    </span>
  );
}

// ─── ServiceChip ──────────────────────────────────────────────────────────────
function ServiceChip({ name, url }) {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const check = () => fetch(`${url}/health`, { signal: AbortSignal.timeout(3000), headers }).then(r => setOk(r.ok)).catch(() => setOk(false));
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [url]);
  return (
    <div className="svc-chip">
      <span className="svc-name">{name}</span>
      <span className="svc-url">{url.replace(/^https?:\/\/[^/]+/, '')}</span>
      <span className={`svc-status ${ok===null?'checking':ok?'up':'down'}`}>
        {ok===null ? '◌' : ok ? '●' : '○'}
      </span>
    </div>
  );
}

// ─── TablesPanel ──────────────────────────────────────────────────────────────
function TablesPanel({ baseUrl }) {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`${baseUrl}/tables`).then(d => setTables(d.tables || d || [])).catch(() => setTables([])).finally(() => setLoading(false));
  }, [baseUrl]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="panel">
      <div className="panel-header">
        <span>DynamoDB Tables ({tables.length})</span>
        <button className="icon-btn" onClick={load}>⟳</button>
      </div>
      {loading ? <p className="muted">Loading tables…</p> : tables.length === 0 ? <p className="muted">No tables found.</p> :
        <ul className="table-list">{tables.map(t => <li key={t}>📋 {t}</li>)}</ul>}
    </div>
  );
}

// ─── MedicationsPanel ─────────────────────────────────────────────────────────
function MedicationsPanel({ baseUrl }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ id:'', patient:'', code:'', description:'', baseCost:'', totalCost:'' });
  const [saving, setSaving]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`${baseUrl}/medications/?limit=200`).then(d => setRows(Array.isArray(d) ? d : d.medications || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, [baseUrl]);
  useEffect(() => { load(); }, [load]);

  const visible = rows.filter(r => !filter || JSON.stringify(r).toLowerCase().includes(filter.toLowerCase()));

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`${baseUrl}/medications/`, { method:'POST', body: JSON.stringify({...form, baseCost:+form.baseCost, totalCost:+form.totalCost}) });
      setShowAdd(false); setForm({ id:'', patient:'', code:'', description:'', baseCost:'', totalCost:'' }); load();
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  const del = async id => {
    if (!confirm(`Delete ${id}?`)) return;
    await apiFetch(`${baseUrl}/medications/${id}`, { method:'DELETE' }).catch(e => alert(e.message));
    load();
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <input className="filter-input" placeholder="Filter by patient / code / description…" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn-primary" onClick={() => setShowAdd(s => !s)}>+ Add</button>
        <button className="icon-btn" onClick={load}>⟳</button>
      </div>
      {showAdd && (
        <div className="add-form">
          {['id','patient','code','description','baseCost','totalCost'].map(f => (
            <input key={f} className="filter-input" placeholder={f} value={form[f]} onChange={e => setForm(p => ({...p,[f]:e.target.value}))} />
          ))}
          <button className="btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
          <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
        </div>
      )}
      <div style={{overflowX:'auto'}}>
        <table className="data-table">
          <thead><tr><th>ID</th><th>Patient</th><th>Code</th><th>Description</th><th>Base $</th><th>Total $</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="muted">Loading…</td></tr> :
              visible.length === 0 ? <tr><td colSpan={7} className="muted" style={{textAlign:'center'}}>No results</td></tr> :
              visible.map(r => (
                <tr key={r.id}>
                  <td className="truncate">{r.id}</td>
                  <td className="truncate">{r.patient}</td>
                  <td>{r.code}</td>
                  <td className="truncate">{r.description}</td>
                  <td>{r.baseCost}</td>
                  <td>{r.totalCost}</td>
                  <td><button className="btn-danger" onClick={() => del(r.id)}>✕</button></td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="muted" style={{marginTop:8}}>{visible.length} items shown</p>
      </div>
    </div>
  );
}

// ─── ExplorerPanel ────────────────────────────────────────────────────────────
function ExplorerPanel({ baseUrl, microOn }) {
  const [target, setTarget] = useState('backend');
  const [method, setMethod] = useState('GET');
  const [path, setPath]     = useState('/medications/?limit=50');
  const [body, setBody]     = useState('');
  const [resp, setResp]     = useState('');
  const [status, setStatus] = useState(0);
  const [busy, setBusy]     = useState(false);

  const effectiveUrl = target === 'backend' ? baseUrl : (MICROSERVICE_URLS[target] ?? baseUrl);

  const send = async () => {
    setBusy(true); setResp(''); setStatus(0);
    const token = getToken();
    const opts = { method, headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) } };
    if (['POST','PUT','PATCH'].includes(method)) opts.body = body || '{}';
    try {
      const res = await fetch(effectiveUrl + path, opts);
      const data = await res.json().catch(() => ({}));
      setStatus(res.status); setResp(JSON.stringify(data, null, 2));
    } catch(e) { setStatus(0); setResp(e.message); } finally { setBusy(false); }
  };

  const statusColor = status >= 200 && status < 300 ? '#a78bfa' : status >= 400 ? '#ef4444' : '#6b7280';

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">🔬 API Explorer</span>
        <label style={{color:'#94a3b8',fontSize:12}}>
          Target:&nbsp;
          <select className="select-input" value={target} onChange={e => setTarget(e.target.value)}>
            <option value="backend">Backend ({baseUrl.replace('http://','').substring(0,28)}…)</option>
            {microOn && Object.entries(MICROSERVICE_URLS).map(([k,v]) =>
              <option key={k} value={k}>{k} ({v.replace('http://','').substring(0,28)})</option>
            )}
          </select>
        </label>
      </div>
      <div className="preset-bar">
        {EXPLORER_PRESETS.map(p => (
          <button key={p.label} className="preset-chip" onClick={() => { setMethod(p.method); setPath(p.path); }}>{p.label}</button>
        ))}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
        <select className="select-input" style={{width:90}} value={method} onChange={e => setMethod(e.target.value)}>
          {['GET','POST','PUT','DELETE','PATCH'].map(m => <option key={m}>{m}</option>)}
        </select>
        <input className="filter-input" style={{flex:1}} value={path} onChange={e => setPath(e.target.value)} placeholder="/path?param=value" />
        <button className="btn-primary" onClick={send} disabled={busy}>{busy ? '…' : '▶ Send'}</button>
      </div>
      {['POST','PUT','PATCH'].includes(method) && (
        <textarea className="json-input" rows={4} placeholder='{"key":"value"}' value={body} onChange={e => setBody(e.target.value)} />
      )}
      {(resp || status > 0) && (
        <div className="response-box">
          <div style={{color:statusColor, fontWeight:600, marginBottom:4}}>HTTP {status}</div>
          <pre style={{margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all'}}>{resp}</pre>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [backendKey, setBackendKey] = useState(HOST === 'localhost' ? 'cmdline' : 'aws');
  const baseUrl = BACKEND_PRESETS[backendKey] ?? BACKEND_PRESETS.aws;
  const [online, setOnline]   = useState(null);
  const [tab, setTab]         = useState('tables');
  const [microOn, setMicroOn] = useState(true);

  const payload  = decodeJwt(getToken() || '');
  const username = payload?.username ?? payload?.name ?? payload?.sub ?? '';

  useEffect(() => {
    if (window.location.search.includes('sso='))
      window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    const check = () => {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000), headers }).then(r => setOnline(r.ok)).catch(() => setOnline(false));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [baseUrl]);

  return (
    <div className="app-shell">
      <header className="header">
        <div className="header-left">
          <span className="logo">💜</span>
          <div>
            <div className="header-title">Healthcare API</div>
            <div className="header-sub">Spring Boot + React</div>
          </div>
          <div className="backend-wrap">
            <label className="label-sm">Backend</label>
            <select className="select-input" value={backendKey} onChange={e => setBackendKey(e.target.value)}>
              {Object.entries(BACKEND_PRESETS).map(([k,v]) =>
                <option key={k} value={k}>{k} — {v.substring(0,35)}</option>
              )}
            </select>
          </div>
          <StatusDot online={online} />
        </div>
        <div className="header-right">
          <button className="btn-micro" onClick={() => setMicroOn(s => !s)}>⚡ Microservices {microOn?'ON':'OFF'}</button>
          {username && <span className="username">👤 {username}</span>}
          <button className="btn-logout" onClick={() => { clearToken(); window.location.href = LANDING; }}>⏏ Log out</button>
        </div>
      </header>

      <div className="content">
        {microOn && (
          <div className="ms-panel">
            <div className="ms-grid">
              {Object.entries(MICROSERVICE_URLS).map(([k,v]) => <ServiceChip key={k} name={k} url={v} />)}
            </div>
          </div>
        )}

        <div className="tabs-bar">
          {[{id:'tables',label:'📋 DynamoDB Tables'},{id:'medications',label:'💊 Medications'},{id:'workflow',label:'⚙️ API Workflow'},{id:'explorer',label:'🔬 API Explorer'}].map(t => (
            <button key={t.id} className={`tab-btn${tab===t.id?' active':''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="tab-content">
          {tab==='tables'      && <TablesPanel      baseUrl={baseUrl} />}
          {tab==='medications' && <MedicationsPanel baseUrl={baseUrl} />}
          {tab==='workflow'    && <OnSubmitWorkflow baseUrl={baseUrl} token={getToken()} />}
          {tab==='explorer'    && <ExplorerPanel    baseUrl={baseUrl} microOn={microOn} />}
        </div>
      </div>
    </div>
  );
}
