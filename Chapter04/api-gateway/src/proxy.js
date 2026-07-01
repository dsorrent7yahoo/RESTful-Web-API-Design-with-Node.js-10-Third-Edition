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
const { SERVICES }    = require('./registry');
const { requireAuth } = require('./auth');

function mountProxies(app) {
  Object.entries(SERVICES).forEach(([key, svc]) => {
    const mountPath = `/proxy/${key}`;

    // Require a valid JWT scoped to this service key
    app.use(mountPath, requireAuth(key));

    const proxy = createProxyMiddleware({
      target:      svc.target,
      changeOrigin: true,
      // Strip the /proxy/<key> prefix before forwarding
      pathRewrite: { [`^/proxy/${key}`]: '' },
      on: {
        error(err, req, res) {
          const body = JSON.stringify({
            error:   'Gateway proxy error',
            service: key,
            target:  svc.target,
            detail:  err.message,
          });
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
          }
          res.end(body);
        },
        proxyReq(proxyReq, req) {
          // Add a tracing header so downstream services know they came through the gateway
          proxyReq.setHeader('X-Gateway-Service', key);
          proxyReq.setHeader('X-Gateway-Version', '1.0');
        },
      },
    });

    app.use(mountPath, proxy);
    console.log(`  ↗  /proxy/${key.padEnd(14)} → ${svc.target}`);
  });
}

module.exports = { mountProxies };
