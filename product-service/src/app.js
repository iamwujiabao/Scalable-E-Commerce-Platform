'use strict';

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const { register } = require('prom-client');

const productRoutes  = require('./routes/product.routes');
const categoryRoutes = require('./routes/category.routes');
const { errorHandler } = require('./middleware/error.middleware');
const logger         = require('./utils/logger');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (m) => logger.http(m.trim()) } }));

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'product-service', uptime: process.uptime() })
);
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api/v1/products',   productRoutes);
app.use('/api/v1/categories', categoryRoutes);

app.use(errorHandler);
module.exports = app;
