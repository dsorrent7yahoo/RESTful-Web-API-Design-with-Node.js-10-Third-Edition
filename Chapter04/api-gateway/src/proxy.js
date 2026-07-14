/**
 * Proxy Router
 * Mounts http-proxy-middleware instances for every registered service at:
 *   /proxy/:serviceKey/*   →   service.target/*
 *
 * Examples:
 *   GET /proxy/django/medications/?topN=5  →  http://localhost:4002/medications/?topN=5
 *   GET /proxy/landing/                    →  http://localhost:5180/
 */

const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt           = require('jsonwebtoken');
const { SERVICES }  = require('./registry');
const { requireAuth } = require('./auth');

// Secret used by all downstream microservices — must match their JWT_SECRET env var
const DOWNSTREAM_SECRET = process.env.JWT_SECRET || 'healthcare-ec2-dev-secret';

function mountProxies(app) {
  Object.entries(SERVICES).forEach(([key, svc]) => {
    const mountPath = `/proxy/${key}`;

    // Auth endpoints (e.g. /auth/login, /auth/register) are intentionally
    // public — the backend handles credential validation. All other proxy
    // routes require a valid gateway JWT scoped to this service.
    const PUBLIC_PROXY_PATHS = ['/auth/login', '/auth/register', '/auth/token'];
    app.use(mountPath, (req, res, next) => {
      if (PUBLIC_PROXY_PATHS.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
        return next(); // skip gateway JWT check — backend validates credentials
      }
      return requireAuth(key)(req, res, next);
    });

    const proxy = createProxyMiddleware({
      target:      svc.target,
      changeOrigin: true,
      // Strip the /proxy/<key> prefix before forwarding
      pathRewrite: { [`^/proxy/${key}`]: '' },
      // v2 API: top-level onError / onProxyReq (not nested under `on:`)
      onError(err, req, res) {
        const body = JSON.stringify({
          error:   'Service unavailable',
          service: key,
          target:  svc.target,
          detail:  err.message,
        });
        if (res.writableEnded) return;
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(body);
      },
      onProxyReq(proxyReq, req) {
        // Add tracing headers so downstream services know they came through the gateway
        proxyReq.setHeader('X-Gateway-Service', key);
        proxyReq.setHeader('X-Gateway-Version', '1.0');
        // Re-sign the token with JWT_SECRET so microservices can verify it.
        // The gateway already validated the incoming token; req.user is set.
        if (req.user) {
          const downstream = jwt.sign(
            { sub: req.user.sub, email: req.user.sub, role: req.user.role || 'admin', scopes: req.user.scopes || [] },
            DOWNSTREAM_SECRET,
            { expiresIn: '1h' }
          );
          proxyReq.setHeader('Authorization', `Bearer ${downstream}`);
        }
      },
    });

    app.use(mountPath, proxy);
    console.log(`  ↗  /proxy/${key.padEnd(14)} → ${svc.target}`);
  });
}

module.exports = { mountProxies };
