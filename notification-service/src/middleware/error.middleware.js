'use strict';

const logger = require('../utils/logger');

exports.errorHandler = (err, req, res, _next) => {
  logger.error('Unhandled error', {
    error:  err.message,
    stack:  err.stack,
    path:   req.path,
    method: req.method,
  });

  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  res.status(status).json({ error: message });
};
