'use strict';

const amqp   = require('amqplib');
const logger = require('../utils/logger');
const db     = require('../db');

const EXCHANGE = 'ecommerce';
let channel;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  logger.info('RabbitMQ connected (product-service)');
  connection.on('error', (err) => logger.error('RabbitMQ error', { error: err.message }));
}

async function publishEvent(routingKey, payload) {
  if (!channel) return;
  channel.publish(EXCHANGE, routingKey,
    Buffer.from(JSON.stringify({ routingKey, payload, ts: new Date().toISOString() })),
    { persistent: true }
  );
}

// Consume order.placed events → reserve inventory
async function consumeInventoryEvents() {
  const q = await channel.assertQueue('product.inventory.reserve', { durable: true });
  await channel.bindQueue(q.queue, EXCHANGE, 'order.placed');

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const { payload } = JSON.parse(msg.content.toString());
      const { items } = payload; // [{ productId, quantity }]

      for (const item of items) {
        await db.query(
          `UPDATE inventory
           SET reserved  = reserved  + $1,
               quantity  = quantity  - $1,
               updated_at = NOW()
           WHERE product_id = $2 AND quantity >= $1`,
          [item.quantity, item.productId]
        );
      }

      channel.ack(msg);
      logger.info('Inventory reserved for order', { orderId: payload.orderId });
    } catch (err) {
      logger.error('Failed to process inventory event', { error: err.message });
      channel.nack(msg, false, false); // dead-letter
    }
  });
}

module.exports = { connectRabbitMQ, publishEvent, consumeInventoryEvents };
