const express = require('express');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.json({ message: 'DynamoDB Backend', version: '1.0.0' });
});

router.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

module.exports = router;
