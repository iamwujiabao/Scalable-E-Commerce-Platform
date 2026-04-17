'use strict';

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const { register } = require('prom-client');
const logger       = require('./utils/logger');
const { connectRabbitMQ } = require('./messaging/rabbitmq');

// ── Express app (minimal – mostly event-driven) ───────────────────────────────
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'notification-service', uptime: process.uptime() })
);
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3006;

async function bootstrap() {
  try {
    await connectRabbitMQ();
    logger.info('RabbitMQ consumer started');

    app.listen(PORT, () =>
      logger.info(`Notification Service running on port ${PORT}`)
    );
  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
bootstrap();
