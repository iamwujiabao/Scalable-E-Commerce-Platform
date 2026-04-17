'use strict';
// app.js
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const { register } = require('prom-client');
const cartRoutes   = require('./routes/cart.routes');
const { errorHandler } = require('./middleware/error.middleware');
const logger       = require('./utils/logger');
const { ping }     = require('./redis');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(morgan('combined', { stream: { write: (m) => logger.http(m.trim()) } }));

app.get('/health', async (_req, res) => {
  try {
    await ping();
    res.json({ status: 'ok', service: 'cart-service', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', service: 'cart-service' });
  }
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api/v1/cart', cartRoutes);
app.use(errorHandler);
module.exports = app;
