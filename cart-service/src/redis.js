'use strict';

const Redis  = require('ioredis');
const logger = require('./utils/logger');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  lazyConnect: false,
});

redis.on('connect',   () => logger.info('Redis connected'));
redis.on('error',     (e) => logger.error('Redis error', { error: e.message }));
redis.on('reconnecting', () => logger.warn('Redis reconnecting'));

const CART_TTL = 7 * 24 * 3600; // 7 days in seconds
const cartKey  = (userId) => `cart:${userId}`;

// ── Repository ────────────────────────────────────────────────────────────────

async function getCart(userId) {
  const raw = await redis.get(cartKey(userId));
  if (!raw) return { userId, items: [], updatedAt: null };
  return JSON.parse(raw);
}

async function saveCart(userId, cart) {
  cart.updatedAt = new Date().toISOString();
  await redis.setex(cartKey(userId), CART_TTL, JSON.stringify(cart));
  return cart;
}

async function clearCart(userId) {
  await redis.del(cartKey(userId));
}

async function ping() {
  return redis.ping();
}

module.exports = { redis, getCart, saveCart, clearCart, ping };
