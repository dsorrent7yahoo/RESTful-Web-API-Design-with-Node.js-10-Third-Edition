var express = require('express');
var router = express.Router();
var jwt = require('jsonwebtoken');
var { User } = require('../model/user');
var { ensureConnected } = require('../model/item');

var JWT_SECRET = process.env.JWT_SECRET || 'chapter04-dev-secret';

/* GET /login — login page */
router.get('/login', function(req, res) {
  var error = req.query.error ? '<p class="error">Invalid username or password.</p>' : '';
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chapter04 API — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0f2f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: #fff; padding: 2.5rem; border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.12); width: 100%; max-width: 380px; }
    h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #1a1a2e; }
    label { display: block; font-size: .85rem; color: #555; margin-bottom: .3rem; margin-top: 1rem; }
    input { width: 100%; padding: .6rem .8rem; border: 1px solid #ccc;
            border-radius: 4px; font-size: 1rem; }
    input:focus { outline: none; border-color: #4a90e2; box-shadow: 0 0 0 2px rgba(74,144,226,.2); }
    button { margin-top: 1.5rem; width: 100%; padding: .75rem;
             background: #4a90e2; color: #fff; border: none;
             border-radius: 4px; font-size: 1rem; cursor: pointer; }
    button:hover { background: #357abd; }
    .error { color: #c0392b; font-size: .875rem; margin-top: 1rem; }
    .hint { margin-top: 1.2rem; font-size: .8rem; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Chapter04 REST API</h1>
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      ${error}
    </form>
    <p class="hint">Dev credentials: <strong>admin / admin123</strong></p>
  </div>
</body>
</html>`);
});

/* POST /login — authenticate and return JWT */
router.post('/login', express.urlencoded({ extended: false }), async function(req, res) {
  try {
    await ensureConnected();
    var { username, password } = req.body;
    var user = await User.findOne({ username: username });
    if (!user) {
      return res.redirect('/login?error=1');
    }
    var match = await user.comparePassword(password);
    if (!match) {
      return res.redirect('/login?error=1');
    }
    var token = jwt.sign({ sub: user._id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Logged in — Chapter04 API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0f2f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: #fff; padding: 2.5rem; border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,.12); width: 100%; max-width: 560px; }
    h1 { font-size: 1.3rem; color: #27ae60; margin-bottom: 1rem; }
    p { color: #555; font-size: .9rem; margin-bottom: .75rem; }
    .token { background: #f4f4f4; padding: .75rem; border-radius: 4px;
             font-family: monospace; font-size: .78rem; word-break: break-all;
             border: 1px solid #ddd; }
    .links { margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; }
    a { display: inline-block; padding: .55rem 1.1rem; background: #4a90e2;
        color: #fff; text-decoration: none; border-radius: 4px; font-size: .9rem; }
    a:hover { background: #357abd; }
    .note { margin-top: 1rem; font-size: .78rem; color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Signed in as ${username}</h1>
    <p>Your Bearer token (valid 8 h):</p>
    <div class="token">${token}</div>
    <p class="note">Add this as an <code>Authorization: Bearer &lt;token&gt;</code> header in API calls or paste it into the Swagger UI Authorize dialog.</p>
    <div class="links">
      <a href="/api-docs">Swagger UI</a>
      <a href="/catalog">Catalog API</a>
    </div>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
