var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var swaggerUi = require('swagger-ui-express');
var openApiSpec = require('./openapi.json');
var flaskSwaggerUrl = process.env.FLASK_SWAGGER_URL || 'http://127.0.0.1:4001/api-docs';

var routes = require('./routes/index');
var catalog = require('./routes/catalog');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
//app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// CORS middleware for local frontend (Vite)
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
app.use('/catalog', catalog);
app.get('/openapi.json', function(req, res) {
  res.json(openApiSpec);
});
app.get('/api-docs/flask', function(req, res) {
  res.redirect(302, flaskSwaggerUrl);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.json({
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({
    message: err.message,
    error: {}
  });
});

if (require.main === module) {
  var port = process.env.PORT || 3000;
  app.listen(port, function() {
    console.log('Chapter04 API listening on port ' + port);
  });
}


module.exports = app;
