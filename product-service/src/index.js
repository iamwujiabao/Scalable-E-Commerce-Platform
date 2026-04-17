'use strict';

const app    = require('./app');
const logger = require('./utils/logger');
const db     = require('./db');
const { connectRabbitMQ, consumeInventoryEvents } = require('./messaging/rabbitmq');

const PORT = process.env.PORT || 3002;

async function bootstrap() {
  try {
    await db.migrate();
    logger.info('Database migrated');
    await connectRabbitMQ();
    await consumeInventoryEvents();
    app.listen(PORT, () => logger.info(`Product Service running on port ${PORT}`));
  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await db.pool.end();
  process.exit(0);
});

bootstrap();
