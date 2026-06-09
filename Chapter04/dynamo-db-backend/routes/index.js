const express = require('express');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.json({ message: 'Chapter04 DynamoDB Backend', version: '1.0.0' });
});

module.exports = router;
