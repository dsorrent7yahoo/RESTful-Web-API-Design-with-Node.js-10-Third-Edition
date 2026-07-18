const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require('morgan');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('./openapi.json');
const medicationModel = require('./model/medication');

const DYNAMODB_TABLE = 'medications';
const CSV_TABLES_DIR = path.join(__dirname, '..', 'coherent-11-07-2022', 'csv');
const AUTO_CREATE_CSV_TABLES = process.env.AUTO_CREATE_CSV_TABLES !== 'false';

process.env.DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || DYNAMODB_TABLE;

function toTableNameFromCsvFile(fileName) {
  return String(fileName || '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function ensureDefaultCsvTablesExist() {
  if (!AUTO_CREATE_CSV_TABLES) {
    return;
  }

  let files = [];
  try {
    files = fs.readdirSync(CSV_TABLES_DIR);
  } catch (error) {
    console.warn('CSV directory not found, skipping table bootstrap:', CSV_TABLES_DIR);
    return;
  }

  const tableNames = Array.from(new Set(
    files
      .filter((fileName) => fileName.toLowerCase().endsWith('.csv'))
      .map((fileName) => toTableNameFromCsvFile(fileName))
      .filter(Boolean)
  ));

  for (const tableName of tableNames) {
    await medicationModel.ensureTableExists(tableName);
  }
}

const DEFAULT_CSV_PATH = process.env.CSV_PATH || path.join(__dirname, '..', 'coherent-11-07-2022', 'csv', 'medications.csv');

if (openApiSpec.paths
  && openApiSpec.paths['/medications/upload']
  && openApiSpec.paths['/medications/upload'].post
  && openApiSpec.paths['/medications/upload'].post.requestBody
  && openApiSpec.paths['/medications/upload'].post.requestBody.content
  && openApiSpec.paths['/medications/upload'].post.requestBody.content['application/json']
  && openApiSpec.paths['/medications/upload'].post.requestBody.content['application/json'].schema
  && openApiSpec.paths['/medications/upload'].post.requestBody.content['application/json'].schema.properties
  && openApiSpec.paths['/medications/upload'].post.requestBody.content['application/json'].schema.properties.csvPath) {
  openApiSpec.paths['/medications/upload'].post.requestBody.content['application/json'].schema.properties.csvPath.example = DEFAULT_CSV_PATH;
}

const routes    = require('./routes/index');
const medications = require('./routes/medications');
const authRoutes  = require('./routes/auth');
const authModule  = require('./modules/auth');

function requireAuth(req, res, next) {
  try {
    req.authUser = authModule.verifyToken(req.headers.authorization);
    next();
  } catch (err) {
    res.status(err.status || 401).json({ status: 'error', message: err.message });
  }
}

const app = express();

app.use(logger('dev'));
app.use(bodyParser.json({ limit: '200mb' }));

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use('/', routes);
app.use('/auth', authRoutes);
app.use('/medications', requireAuth, medications);

app.get('/launch/frontend', function(req, res) {
  res.redirect(302, 'http://localhost:5174/');
});

app.get('/tables', function(req, res) {
  console.log('GET /tables');
  medicationModel.listTables()
    .then(function(tables) {
      res.json({ tables: tables });
    })
    .catch(function(error) {
      console.error(error);
      res.status(500).json({ status: 'error', message: error.message });
    });
});

app.get('/openapi.json', function(req, res) {
  res.json(openApiSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(function(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({
    message: err.message,
    error: app.get('env') === 'development' ? err : {}
  });
});

if (require.main === module) {
  const port = process.env.PORT || 4001;

  ensureDefaultCsvTablesExist()
    .then(function() {
      return medicationModel.ensureTableExists();
    })
    .then(function() {
      app.listen(port, function() {
        console.log('DynamoDB Backend listening on port ' + port);
      });
    })
    .catch(function(error) {
      console.error('Failed to initialize DynamoDB table:', error.message);
      process.exit(1);
    });
}

module.exports = app;
