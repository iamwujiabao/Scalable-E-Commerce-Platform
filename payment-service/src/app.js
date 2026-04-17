'use strict';
// app.js
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const { register } = require('prom-client');
const paymentRoutes = require('./routes/payment.routes');
const { errorHandler } = require('./middleware/error.middleware');
const logger        = require('./utils/logger');

const app = express();
app.use(helmet());
app.use(cors());

// Raw body for Stripe webhook (must be before json middleware)
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '512kb' }));
app.use(morgan('combined', { stream: { write: (m) => logger.http(m.trim()) } }));

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'payment-service', uptime: process.uptime() })
);
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/webhooks', paymentRoutes);
app.use(errorHandler);

module.exports = app;
