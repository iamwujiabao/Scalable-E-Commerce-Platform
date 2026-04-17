'use strict';

const amqp   = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE = 'ecommerce';
let channel;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  logger.info('RabbitMQ connected (payment-service)');
  connection.on('error', (err) => logger.error('RabbitMQ error', { error: err.message }));
}

async function publishEvent(routingKey, payload) {
  if (!channel) return;
  channel.publish(
    EXCHANGE, routingKey,
    Buffer.from(JSON.stringify({ routingKey, payload, ts: new Date().toISOString() })),
    { persistent: true },
  );
  logger.debug('Event published', { routingKey });
}

module.exports = { connectRabbitMQ, publishEvent };
