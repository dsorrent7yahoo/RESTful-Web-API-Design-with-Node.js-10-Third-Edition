'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../modules/auth');

// POST /auth/login
router.post('/login', async function(req, res) {
  try {
    const result = await auth.loginUser(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message || 'Login failed' });
  }
});

// POST /auth/logout  — stateless JWT: client discards token; nothing server-side to clear
router.post('/logout', function(req, res) {
  res.json({ status: 'ok', message: 'Logged out' });
});

// GET /auth/me  — validate token and return current user
router.get('/me', function(req, res) {
  try {
    const claims = auth.verifyToken(req.headers.authorization);
    res.json({ status: 'ok', user: { email: claims.email, username: claims.username } });
  } catch (err) {
    res.status(err.status || 401).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
