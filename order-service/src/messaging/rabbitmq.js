'use strict';

const amqp   = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE = 'ecommerce';
let channel;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  logger.info('RabbitMQ connected (order-service)');
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

// Listen for payment.completed → update order payment status
async function consumePaymentEvents(updateOrderPayment) {
  const q = await channel.assertQueue('order.payment.result', { durable: true });
  await channel.bindQueue(q.queue, EXCHANGE, 'payment.completed');
  await channel.bindQueue(q.queue, EXCHANGE, 'payment.failed');

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const { routingKey, payload } = JSON.parse(msg.content.toString());
      await updateOrderPayment(payload, routingKey === 'payment.completed');
      channel.ack(msg);
    } catch (err) {
      logger.error('Error processing payment event', { error: err.message });
      channel.nack(msg, false, false);
    }
  });
}

module.exports = { connectRabbitMQ, publishEvent, consumePaymentEvents };
