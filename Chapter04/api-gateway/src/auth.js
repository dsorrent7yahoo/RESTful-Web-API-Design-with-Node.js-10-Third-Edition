/**
 * auth.js — IAM layer for the Healthcare API Gateway
 *
 * Roles:
 *   admin    → full dashboard + all proxy routes (password login)
 *   customer → read-only dashboard filtered to their assigned scopes (API key login)
 *
 * Environment variables:
 *   GATEWAY_JWT_SECRET      — HMAC-SHA256 secret  (default: dev placeholder)
 *   GATEWAY_ADMIN_PASSWORD  — admin password       (default: "admin")
 *   GATEWAY_CUSTOMER_KEYS   — JSON object keyed by API key:
 *                             { "<key>": { "name": "Acme Corp", "scopes": ["django","flask"] } }
 */

'use strict';

const jwt = require('jsonwebtoken');

const SECRET   = process.env.GATEWAY_JWT_SECRET      || 'gateway-jwt-dev-secret-change-in-prod';
const ADMIN_PW = process.env.GATEWAY_ADMIN_PASSWORD  || 'admin';

// ---------------------------------------------------------------------------
// Customer key store
// ---------------------------------------------------------------------------

function loadCustomers() {
  try {
    return JSON.parse(process.env.GATEWAY_CUSTOMER_KEYS || '{}');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function createToken(payload, expiresIn = '8h') {
  return jwt.sign({ ...payload, iss: 'healthcare-api-gateway' }, SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.query.token || null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * requireAuth([serviceKey])
 * Verifies the bearer JWT.
 * - admin: always passes
 * - customer: passes when serviceKey is in their scopes (or no serviceKey given)
 */
function requireAuth(serviceKey) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        hint:  'POST /api/auth/login with { username, password } or { apiKey }',
      });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Admin always passes
    if (payload.role === 'admin') {
      req.user = payload;
      return next();
    }

    // Customer: enforce scope when a service key is specified
    if (serviceKey && Array.isArray(payload.scopes) && payload.scopes.length > 0) {
      if (!payload.scopes.includes(serviceKey)) {
        return res.status(403).json({
          error:  'Forbidden',
          detail: `Your access is scoped to: ${payload.scopes.join(', ')}`,
        });
      }
    }

    req.user = payload;
    return next();
  };
}

/** requireAdmin — gateway management operations (admin only) */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload)               return res.status(401).json({ error: 'Invalid or expired token' });
  if (payload.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  req.user = payload;
  return next();
}

// ---------------------------------------------------------------------------
// Login handler  (POST /api/auth/login)
// ---------------------------------------------------------------------------

function loginHandler(req, res) {
  const { username, password, apiKey } = req.body || {};

  // Admin login
  if (username === 'admin' && password === ADMIN_PW) {
    const token = createToken({ sub: 'admin', name: 'Administrator', role: 'admin', scopes: [] });
    return res.json({ token, role: 'admin', name: 'Administrator', scopes: [] });
  }

  // Customer API key login
  if (apiKey) {
    const customers = loadCustomers();
    const customer  = customers[apiKey];
    if (customer) {
      const token = createToken(
        { sub: apiKey, name: customer.name, role: 'customer', scopes: customer.scopes || [] },
        '90d',
      );
      return res.json({ token, role: 'customer', name: customer.name, scopes: customer.scopes || [] });
    }
  }

  return res.status(401).json({ error: 'Invalid credentials' });
}

module.exports = { requireAuth, requireAdmin, loginHandler, verifyToken, extractToken };
