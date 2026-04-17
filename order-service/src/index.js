'use strict';

const app    = require('./app');
const logger = require('./utils/logger');
const db     = require('./db');
const { connectRabbitMQ, consumePaymentEvents } = require('./messaging/rabbitmq');
const { updateOrderPayment } = require('./controllers/order.controller');

const PORT = process.env.PORT || 3004;

async function bootstrap() {
  try {
    await db.migrate();
    logger.info('Database migrated');
    await connectRabbitMQ();
    await consumePaymentEvents(updateOrderPayment);
    logger.info('Listening for payment events');
    app.listen(PORT, () => logger.info(`Order Service running on port ${PORT}`));
  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await db.pool.end(); process.exit(0); });
bootstrap();
