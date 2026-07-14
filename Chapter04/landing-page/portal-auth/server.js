#!/usr/bin/env node
/**
 * portal-auth/server.js — Standalone auth backend for the Portal image.
 *
 * POST /api/auth/login   { username, password } → { token, user }
 * GET  /api/auth/verify                         → 200 if JWT valid
 * GET  /api/health                              → { status: "ok" }
 *
 * Environment:
 *   PORTAL_JWT_SECRET    JWT signing secret   (default: portal-dev-secret)
 *   PORTAL_ADMIN_PW      Admin password        (default: admin)
 *   PORT                 Listen port           (default: 3001)
 */

'use strict';

const http  = require('http');
const crypto = require('crypto');

const SECRET   = process.env.PORTAL_JWT_SECRET   || 'portal-dev-secret-change-in-prod';
const ADMIN_PW = process.env.PORTAL_ADMIN_PW      || 'admin';
const PORT     = parseInt(process.env.PORT || '3001', 10);

// ── Minimal JWT (HS256) without external deps ─────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signJWT(payload, expiresInSec = 28800) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + expiresInSec }));
  const sig     = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest());
  if (expected !== parts[2]) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}

// ── Request handler ──────────────────────────────────────────────────────────
function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // Health
  if (url === '/api/health' || url === '/health') {
    return json(200, { status: 'ok', service: 'portal-auth' });
  }

  // Login
  if (url === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body || '{}');
        if (username === 'admin' && password === ADMIN_PW) {
          const token = signJWT({ sub: 'admin', username: 'admin', role: 'admin' });
          return json(200, { token, user: { username: 'admin', role: 'admin' } });
        }
        return json(401, { message: 'Invalid credentials' });
      } catch {
        return json(400, { message: 'Bad request' });
      }
    });
    return;
  }

  // Verify
  if (url === '/api/auth/verify' && req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const payload = verifyJWT(auth.replace('Bearer ', ''));
    return payload ? json(200, { valid: true, user: payload })
                   : json(401, { valid: false });
  }

  json(404, { message: 'Not found' });
}

http.createServer(handler).listen(PORT, () =>
  console.log(`portal-auth listening on :${PORT}`)
);
