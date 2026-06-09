var express    = require('express');
var path       = require('path');
var logger     = require('morgan');
var bodyParser = require('body-parser');
var swaggerUi  = require('swagger-ui-express');
var openApiSpec = require('./openapi.json');

var routes      = require('./routes/index');
var medications = require('./routes/medications');

var app = express();

app.use(logger('dev'));
app.use(bodyParser.json());

// CORS middleware - allow localhost dev tools on any port
app.use(function(req, res, next) {
  var origin = req.headers.origin || '';
  if (/^http:\/\/localhost:\d+$/.test(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use('/', routes);
app.use('/medications', medications);
app.get('/openapi.json', function(req, res) {
  res.json(openApiSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// 404 handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// Error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({
    message: err.message,
    error: app.get('env') === 'development' ? err : {}
  });
});

if (require.main === module) {
  var port = process.env.PORT || 4000;
  app.listen(port, function() {
    console.log('Chapter04 Medications API listening on port ' + port);
  });
}

module.exports = app;
