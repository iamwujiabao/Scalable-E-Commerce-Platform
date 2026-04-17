'use strict';

const app    = require('./app');
const logger = require('./utils/logger');
const { connectRabbitMQ } = require('./messaging/rabbitmq');

const PORT = process.env.PORT || 3005;

async function bootstrap() {
  try {
    await connectRabbitMQ();
    app.listen(PORT, () => logger.info(`Payment Service running on port ${PORT}`));
  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
bootstrap();
