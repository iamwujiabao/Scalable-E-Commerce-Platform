'use strict';

const app      = require('./app');
const logger   = require('./utils/logger');
const db       = require('./db');
const { connectRabbitMQ } = require('./messaging/rabbitmq');

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    // Run DB migrations
    await db.migrate();
    logger.info('Database migrated successfully');

    // Connect to RabbitMQ
    await connectRabbitMQ();
    logger.info('Connected to RabbitMQ');

    app.listen(PORT, () => {
      logger.info(`User Service running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start User Service', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received – shutting down gracefully');
  await db.pool.end();
  process.exit(0);
});

bootstrap();
