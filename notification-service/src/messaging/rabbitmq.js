'use strict';

const amqp   = require('amqplib');
const logger = require('../utils/logger');
const { sendEmail, sendSMS } = require('../notifications');

const EXCHANGE = 'ecommerce';
const QUEUE    = 'notification.events';

const BINDINGS = [
  'user.registered',
  'order.placed',
  'order.confirmed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'payment.completed',
  'payment.failed',
  'payment.refunded',
];

let channel;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  const q = await channel.assertQueue(QUEUE, {
    durable:   true,
    arguments: {
      'x-dead-letter-exchange': `${EXCHANGE}.dlx`,
      'x-message-ttl': 86400000, // 24h TTL
    },
  });

  // DLX for failed notifications
  await channel.assertExchange(`${EXCHANGE}.dlx`, 'topic', { durable: true });

  for (const key of BINDINGS) {
    await channel.bindQueue(q.queue, EXCHANGE, key);
  }

  // Max 5 unacknowledged messages at once
  channel.prefetch(5);

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    let parsed;
    try {
      parsed = JSON.parse(msg.content.toString());
    } catch {
      logger.warn('Malformed message received – discarding');
      channel.nack(msg, false, false);
      return;
    }

    const { routingKey, payload } = parsed;
    logger.info('Notification event received', { routingKey });

    try {
      await handleEvent(routingKey, payload);
      channel.ack(msg);
    } catch (err) {
      logger.error('Failed to handle notification event', {
        routingKey,
        error: err.message,
      });
      // Requeue once, then dead-letter
      const redelivered = msg.fields.redelivered;
      channel.nack(msg, false, !redelivered);
    }
  });

  logger.info('Notification consumer started', { bindings: BINDINGS });
  connection.on('error', (err) => logger.error('RabbitMQ error', { error: err.message }));
}

async function handleEvent(eventType, payload) {
  const { email, phone } = payload;

  switch (eventType) {
    case 'user.registered':
      await sendEmail(email, eventType, payload);
      break;

    case 'order.placed':
    case 'order.confirmed':
    case 'order.shipped':
    case 'order.delivered':
    case 'order.cancelled':
      await Promise.all([
        sendEmail(email, eventType, payload),
        sendSMS(phone, eventType, payload),
      ]);
      break;

    case 'payment.completed':
    case 'payment.failed':
    case 'payment.refunded':
      await sendEmail(email, eventType, payload);
      break;

    default:
      logger.debug('No handler for event type', { eventType });
  }
}

module.exports = { connectRabbitMQ };
