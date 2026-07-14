import { useEffect, useState } from 'react';
import './App.css';

// Auto-detect the host so links work both locally and on any EC2 IP.
const HOST = window.location.hostname;

const APPS = [
  {
    id: 'rag',
    name: 'Clinical Decision Support (RAG)',
    stack: 'Python · FastAPI · ClinicalBERT · AWS Bedrock Claude Sonnet 4.6',
    icon: '🧠',
    gradient: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
    accentColor: '#a78bfa',
    frontendUrl: `http://${HOST}:5050`,
    apiUrl: `http://${HOST}:5050`,
    healthPath: '/health',
    description:
      'RAG-powered clinical decision support — FDA drug labels indexed with ClinicalBERT, queried via AWS Bedrock Claude Sonnet 4.6. Covers pharmacist DRP review, natural-language EHR querying, and evidence-based diagnosis support.',
    features: [
      'RAG: Pharmacist DRP Review',
      'RAG: EHR Natural Language Query',
      'RAG: Diagnosis Support',
      'ClinicalBERT Embeddings',
      'AWS Bedrock Claude Sonnet 4.6',
      '1,036 Indexed FDA Documents',
    ],
    portNote: `Combined image (nginx + 5 FastAPI services) on port 5000`,
  },
  {
    id: 'django-ts',
    name: 'Django TypeScript',
    stack: 'TypeScript · React 18 · Django REST Framework · DynamoDB',
    icon: '💙',
    gradient: 'linear-gradient(135deg, #6366f1, #4338ca)',
    accentColor: '#818cf8',
    frontendUrl: `http://${HOST}:3005`,
    apiUrl: `http://${HOST}:4002`,
    healthPath: '/health',
    description:
      'TypeScript-first conversion of the Django frontend — full type safety, React 18, and Vite. Same Django REST Framework backend, zero JavaScript in the source.',
    features: [
      'Full TypeScript (strict)',
      'React 18 + Vite 5',
      'Medications CRUD',
      'API Explorer (typed)',
      'Claims + SQS Pipeline',
      'Athena SQL Client',
    ],
    portNote: `Frontend (Docker): port 3005  ·  API: port 4002`,
  },
  {
    id: 'node',
    name: 'Node.js ReactJs',
    stack: 'JavaScript · Express · DynamoDB',
    icon: '🟩',
    gradient: 'linear-gradient(135deg, #22c55e, #15803d)',
    accentColor: '#4ade80',
    frontendUrl: `http://${HOST}:3002`,
    apiUrl: `http://${HOST}:4003`,
    healthPath: '/health',
    description:
      'Classic RESTful medications API built with Express.js — the original backend from the course, now powered by AWS DynamoDB.',
    features: [
      'Medications CRUD',
      'CSV Upload & Seed',
      'Multi-table DynamoDB',
      'JWT Authentication',
      'Swagger / OpenAPI',
      'Pagination & Filters',
    ],
    portNote: `Frontend: port 3002  ·  API: port 4003`,
  },
  {
    id: 'django',
    name: 'Django ReactJs',
    stack: 'Python · Django REST Framework · DynamoDB',
    icon: '🎸',
    gradient: 'linear-gradient(135deg, #f59e0b, #b45309)',
    accentColor: '#fbbf24',
    frontendUrl: `http://${HOST}:3003`,
    apiUrl: `http://${HOST}:4002`,
    healthPath: '/health',
    description:
      'Microservices-ready medications API built with Django REST Framework, featuring claims processing, SQS monitoring, and Kubernetes support.',
    features: [
      'Medications CRUD',
      'Claims Generator / Cleaner',
      'SQS Monitor',
      'Athena Client',
      'Patients & Encounters',
      'Kubernetes Ready',
    ],
    portNote: `Frontend: port 3003  ·  API: port 4002`,
  },
  {
    id: 'flask',
    name: 'Flask ReactJs',
    stack: 'Python · Flask · DynamoDB',
    icon: '🐍',
    gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    accentColor: '#60a5fa',
    // Flask serves its own React frontend on the same port as the API.
    frontendUrl: `http://${HOST}:4001`,
    apiUrl: `http://${HOST}:4001`,
    healthPath: '/health',
    description:
      'Full-stack RESTful medications API with S3 export, AWS Glue catalog registration, SQS claims pipeline, and Athena querying.',
    features: [
      'Medications CRUD',
      'CSV → DynamoDB Upload',
      'DynamoDB → S3 Export',
      'Glue Catalog Integration',
      'SQS + Claims Pipeline',
      'Athena SQL Queries',
    ],
    portNote: `Frontend + API bundled on port 4001`,
  },
  {
    id: 'springboot',
    name: 'Spring Boot / ReactJs',
    stack: 'Java · Spring Boot 3 · DynamoDB',
    icon: '🍃',
    gradient: 'linear-gradient(135deg, #6ee7b7, #059669)',
    accentColor: '#34d399',
    frontendUrl: `http://${HOST}:5181`,
    apiUrl: `http://${HOST}:4004`,
    healthPath: '/health',
    description:
      'Enterprise-grade RESTful medications API built with Spring Boot 3, featuring JWT auth, AWS Bedrock AI SQL generation, Athena querying, and full S3/Glue pipeline.',
    features: [
      'Medications CRUD',
      'JWT Authentication',
      'DynamoDB → S3 Export',
      'Glue Catalog Integration',
      'SQS + Claims Pipeline',
      'AI SQL via Bedrock',
    ],
    portNote: `Frontend: port 5181  ·  API: port 4004`,
  },
];

// ── Health status dot ─────────────────────────────────────────────────────────
function StatusDot({ url, healthPath }) {
  const [status, setStatus] = useState('checking'); // checking | up | down

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${url}${healthPath}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!cancelled) setStatus(res.ok ? 'up' : 'down');
      } catch {
        if (!cancelled) setStatus('down');
      }
    };

    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, healthPath]);

  const cfg = {
    checking: { color: '#94a3b8', label: 'Checking…' },
    up:       { color: '#22c55e', label: 'Online'    },
    down:     { color: '#ef4444', label: 'Offline'   },
  }[status];

  return (
    <span className="status-dot-wrapper">
      <span className="status-dot" style={{ background: cfg.color }} />
      <span style={{ color: cfg.color }}>{cfg.label}</span>
    </span>
  );
}

// ── AppCard ─────────────────────────────────────────────────────────────────
function AppCard({ app, token }) {
  const launchHref = token ? `${app.frontendUrl}?sso=${encodeURIComponent(token)}` : app.frontendUrl;
  return (
    <div className="app-card">
      <div className="app-card-header" style={{ background: app.gradient }}>
        <span className="app-icon">{app.icon}</span>
        <div className="app-title-block">
          <h2 className="app-name">{app.name}</h2>
          <p className="app-stack">{app.stack}</p>
        </div>
        <div className="app-status">
          <StatusDot url={app.apiUrl} healthPath={app.healthPath} />
        </div>
      </div>

      <div className="app-card-body">
        <p className="app-description">{app.description}</p>
        <ul className="app-features">
          {app.features.map((f) => (
            <li key={f} style={{ borderColor: app.accentColor + '44', color: '#cbd5e1' }}>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="app-card-footer">
        <p className="app-port-note">{app.portNote}</p>
        <a
          href={launchHref}
          target="_blank"
          rel="noreferrer"
          className="launch-btn"
          style={{ background: app.gradient }}
        >
          Launch {app.name} App →
        </a>
      </div>
    </div>
  );
}

// ── Login gate ───────────────────────────────────────────────────────────────
// VITE_GATEWAY_URL is empty in the standalone portal image (uses same origin /api)
const GW = import.meta.env.VITE_GATEWAY_URL ?? `http://${HOST}:8080`;
const TOKEN_KEY = 'healthcare_gw_token';

function LoginGate({ onLogin, apps }) {
  const [user, setUser]   = useState('admin');
  const [pass, setPass]   = useState('');
  const [err,  setErr]    = useState('');
  const [busy, setBusy]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');

    // Open blank windows synchronously here (direct user-gesture — browsers allow it).
    // If the fetch fails we close them; if it succeeds we navigate to each app.
    const appWindows = apps.map((app) => window.open('about:blank', `app_${app.id}`));

    try {
      const res = await fetch(`${GW}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.message || data.detail || 'Login failed');
      sessionStorage.setItem(TOKEN_KEY, data.token);

      // Navigate pre-opened windows to their actual frontend URLs with SSO token
      const tok = data.token;
      appWindows.forEach((w, i) => {
        if (w) w.location.href = `${apps[i].frontendUrl}?sso=${encodeURIComponent(tok)}`;
      });

      onLogin(data.token, data.user);
    } catch (ex) {
      appWindows.forEach((w) => w?.close()); // clean up blanks on failure
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    }}>
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 16,
        padding: '2.5rem 2rem', width: '100%', maxWidth: 380, boxShadow: '0 25px 50px rgba(0,0,0,.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏥</div>
          <h1 style={{ color: '#f1f5f9', fontSize: '1.4rem', margin: 0 }}>Health Care Developer Web Site</h1>
          <p style={{ color: '#64748b', fontSize: '.875rem', marginTop: 4 }}>All data is synthetically generated</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ color: '#94a3b8', fontSize: '.8rem', display: 'block', marginBottom: 4 }}>Username</label>
            <input
              value={user} onChange={e => setUser(e.target.value)} required autoFocus
              style={{
                width: '100%', padding: '0.6rem 0.75rem', background: '#0f172a',
                border: '1px solid #475569', borderRadius: 8, color: '#f1f5f9',
                fontSize: '0.95rem', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ color: '#94a3b8', fontSize: '.8rem', display: 'block', marginBottom: 4 }}>Password</label>
            <input
              type="password" value={pass} onChange={e => setPass(e.target.value)} required
              placeholder="••••••••"
              style={{
                width: '100%', padding: '0.6rem 0.75rem', background: '#0f172a',
                border: '1px solid #475569', borderRadius: 8, color: '#f1f5f9',
                fontSize: '0.95rem', boxSizing: 'border-box',
              }}
            />
          </div>

          {err && <p style={{ color: '#ef4444', fontSize: '.85rem', margin: 0 }}>⚠ {err}</p>}

          <button
            type="submit" disabled={busy}
            style={{
              marginTop: 8, padding: '0.7rem', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: busy ? '#334155' : 'linear-gradient(135deg, #6366f1, #4338ca)',
              color: '#fff', fontSize: '1rem', fontWeight: 600,
            }}
          >
            {busy ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <p style={{ color: '#475569', fontSize: '.75rem', textAlign: 'center', marginTop: '1.5rem' }}>
          Default: admin / admin
        </p>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
function decodeJwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch { return null; }
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [authUser, setAuthUser] = useState(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    const payload = decodeJwtPayload(stored);
    if (!payload || payload.exp * 1000 <= Date.now()) return null;
    return { username: payload.username ?? payload.sub, role: payload.role };
  });

  if (!token) {
    return <LoginGate onLogin={(t, u) => {
      setToken(t);
      // API Gateway returns { token, role, name } with no `user` field — decode from JWT
      if (u) {
        setAuthUser(u);
      } else {
        const p = decodeJwtPayload(t);
        setAuthUser(p ? { username: p.username ?? p.name ?? p.sub, role: p.role } : null);
      }
    }} apps={APPS} />;
  }

  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); };

  return (
    <div className="landing">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-icon">🏥</span>
            <div>
              <h1>Health Care Developer Web Site</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {authUser && (
              <span style={{ color: '#94a3b8', fontSize: '.85rem' }}>
                👤 {authUser.username ?? authUser}
              </span>
            )}
            <button
              onClick={logout}
              style={{
                padding: '0.4rem 1rem', borderRadius: 8, border: '1px solid #475569',
                background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '.85rem',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Cards */}
      <main className="main">
        <div className="cards-grid">
          {APPS.map((app) => (
            <AppCard key={app.id} app={app} apps={APPS} token={token} />
          ))}
        </div>

        {/* Architecture reference table */}
        <section className="arch-section">
          <h3>Port Reference</h3>
          <div className="arch-table">
            <div className="arch-row arch-header">
              <span>Framework</span>
              <span>Frontend URL</span>
              <span>API URL</span>
              <span>DynamoDB Table</span>
            </div>
            {APPS.map((app) => (
              <div key={app.id} className="arch-row">
                <span style={{ color: app.accentColor, fontWeight: 600 }}>{app.name}</span>
                <span>
                  <a href={app.frontendUrl} target="_blank" rel="noreferrer" className="arch-link">
                    <code>{app.frontendUrl}</code>
                  </a>
                </span>
                <span>
                  <code>{app.apiUrl}</code>
                </span>
                <span>
                  <code>medications</code>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Quick-start note */}
        <section className="note-section">
          <h3>Node.js, Django, Django TypeScript &amp; Spring Boot: Set the API URL</h3>
          <p>
            These frontends have a configurable <strong>Base URL</strong> / <strong>Backend</strong> selector.
            After clicking Launch, select or paste the matching API URL and click Connect.
            Flask is not listed here because its frontend and API are bundled together on port 4001 — no separate URL configuration is needed.
            The <strong>Django TypeScript</strong> frontend runs from Docker on port 3005 and connects to the same Django API on port 4002.
          </p>
        </section>
      </main>

      <footer className="footer">
        <p>RESTful Web API Design with Node.js 10 · Chapter 04 · Powered by AWS DynamoDB &amp; RAG</p>
        <p className="footer-host">
          EC2 host: <code>{HOST}</code>
        </p>
      </footer>
    </div>
  );
}
