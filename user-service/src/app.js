'use strict';

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const morgan        = require('morgan');
const { register }  = require('prom-client');

const authRoutes    = require('./routes/auth.routes');
const userRoutes    = require('./routes/user.routes');
const { errorHandler } = require('./middleware/error.middleware');
const logger        = require('./utils/logger');

const app = express();

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// ── Health & Metrics ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service', uptime: process.uptime() });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',  authRoutes);
app.use('/api/v1/users', userRoutes);

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
