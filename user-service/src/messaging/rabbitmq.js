'use strict';

const amqp   = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE = 'ecommerce';

let channel;

async function connectRabbitMQ() {
  const url        = process.env.RABBITMQ_URL || 'amqp://localhost';
  const connection = await amqp.connect(url);
  channel          = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  logger.info('RabbitMQ channel established');

  connection.on('error', (err) => logger.error('RabbitMQ connection error', { error: err.message }));
  connection.on('close', () => logger.warn('RabbitMQ connection closed – reconnecting', {}));
}

async function publishEvent(routingKey, payload) {
  if (!channel) return;
  const msg = Buffer.from(JSON.stringify({ routingKey, payload, ts: new Date().toISOString() }));
  channel.publish(EXCHANGE, routingKey, msg, { persistent: true });
  logger.debug('Event published', { routingKey });
}

module.exports = { connectRabbitMQ, publishEvent };
