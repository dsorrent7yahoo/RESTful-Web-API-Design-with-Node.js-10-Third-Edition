/**
 * API Gateway — Main Entry Point
 *
 * Port: 8080 (override with PORT env var)
 *
 * Routes:
 *   GET  /              → Status dashboard (HTML)
 *   GET  /health        → Aggregated health check (JSON)
 *   GET  /status        → Detailed per-service status (JSON)
 *   GET  /registry      → Service registry listing (JSON)
 *   ANY  /proxy/:svc/*  → Reverse proxy to registered service
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { checkAll }     = require('./healthChecker');
const { mountProxies } = require('./proxy');
const { SERVICES }     = require('./registry');
const { requireAuth, requireAdmin, loginHandler, verifyToken, extractToken } = require('./auth');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Middleware ───────────────────────────────────────────────────────────────

// CORS — allow all origins (gateway is the single trusted entry point)
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] }));

// Request logging
app.use(morgan(':method :url :status :response-time ms - :res[content-length]'));

// Body parsing (for gateway's own routes only — proxied requests must bypass
// this so that http-proxy-middleware can forward the raw body stream intact)
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy/')) return next();
  express.json()(req, res, next);
});

// Rate limiter on the gateway's own management endpoints
const mgmtLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to gateway management endpoints' },
});

// ── Auth routes (unauthenticated) ──────────────────────────────────────────

/** POST /api/auth/login — returns a JWT for admin or customer */
app.post('/api/auth/login', mgmtLimiter, loginHandler);

/** GET /api/auth/me — decode the current token without re-verifying password */
app.get('/api/auth/me', (req, res) => {
  const token   = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ sub: payload.sub, name: payload.name, role: payload.role, scopes: payload.scopes });
});

// ── Management routes ────────────────────────────────────────────────────────

/** GET /health — quick aggregated health (open — used by load balancers / Docker healthcheck) */
app.get('/health', mgmtLimiter, async (req, res) => {
  const { services, summary } = await checkAll();
  const httpStatus = summary.down === summary.total ? 503
    : summary.down > 0 ? 207
    : 200;
  res.status(httpStatus).json({
    gateway: 'healthcare-api-gateway',
    version: '1.0.0',
    ...summary,
    services: services.map(({ key, label, icon, status, latencyMs, httpStatus: svcHttp, error }) => ({
      key, label, icon, status, latencyMs, httpStatus: svcHttp, error,
    })),
  });
});

/** GET /status — full per-service details (requires auth; customers get filtered view) */
app.get('/status', mgmtLimiter, requireAuth(), async (req, res) => {
  const { services, summary } = await checkAll();
  const user     = req.user;
  const filtered = (user.role === 'admin' || !user.scopes?.length)
    ? services
    : services.filter((s) => user.scopes.includes(s.key));
  res.json({ gateway: 'healthcare-api-gateway', summary, services: filtered, user: { role: user.role, scopes: user.scopes } });
});

/** GET /registry — list all registered services (requires auth; customers get filtered view) */
app.get('/registry', mgmtLimiter, requireAuth(), (req, res) => {
  const user = req.user;
  const allowedKeys = (user.role === 'admin' || !user.scopes?.length) ? null : new Set(user.scopes);
  const list = Object.entries(SERVICES)
    .filter(([key]) => !allowedKeys || allowedKeys.has(key))
    .map(([key, svc]) => ({
      key,
      label:      svc.label,
      icon:       svc.icon,
      category:   svc.category,
      target:     svc.target,
      proxyPath:  `/proxy/${key}`,
      launchUrl:  svc.launchUrl || null,
      description: svc.description,
    }));
  res.json({ count: list.length, services: list, user: { role: user.role, scopes: user.scopes } });
});

// ── Proxy routes ─────────────────────────────────────────────────────────────
console.log('\n📡 Mounting proxy routes:');
mountProxies(app);

// ── Status Dashboard (served at root) ────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── 404 fallthrough ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error:   'Not Found',
    path:    req.path,
    hint:    'Try GET /registry to see available proxy paths',
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Gateway Error]', err.message);
  res.status(500).json({ error: 'Internal gateway error', detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 API Gateway running on http://localhost:${PORT}`);
  console.log(`   Dashboard : http://localhost:${PORT}/`);
  console.log(`   Health    : http://localhost:${PORT}/health`);
  console.log(`   Status    : http://localhost:${PORT}/status`);
  console.log(`   Registry  : http://localhost:${PORT}/registry\n`);
});

module.exports = app;
