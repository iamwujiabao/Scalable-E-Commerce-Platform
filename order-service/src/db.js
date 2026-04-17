'use strict';

const { Pool } = require('pg');
const logger   = require('./utils/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'orderdb',
  user:     process.env.DB_USER     || 'order_svc',
  password: process.env.DB_PASSWORD || 'order_secret',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));

const MIGRATIONS = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

  `CREATE TYPE order_status AS ENUM (
    'pending', 'confirmed', 'processing', 'shipped',
    'delivered', 'cancelled', 'refunded'
  )`,

  `CREATE TYPE payment_status AS ENUM (
    'pending', 'paid', 'failed', 'refunded'
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID           NOT NULL,
    order_number     VARCHAR(20)    NOT NULL UNIQUE,
    status           order_status   NOT NULL DEFAULT 'pending',
    payment_status   payment_status NOT NULL DEFAULT 'pending',
    payment_intent   VARCHAR(255),
    subtotal         NUMERIC(12,2)  NOT NULL,
    tax              NUMERIC(12,2)  NOT NULL DEFAULT 0,
    shipping_cost    NUMERIC(12,2)  NOT NULL DEFAULT 0,
    discount         NUMERIC(12,2)  NOT NULL DEFAULT 0,
    total            NUMERIC(12,2)  NOT NULL,
    currency         CHAR(3)        NOT NULL DEFAULT 'USD',
    notes            TEXT,
    -- Shipping snapshot (denormalized so address changes don't break history)
    ship_name        VARCHAR(255),
    ship_line1       VARCHAR(255),
    ship_line2       VARCHAR(255),
    ship_city        VARCHAR(100),
    ship_state       VARCHAR(100),
    ship_postal      VARCHAR(20),
    ship_country     CHAR(2)        DEFAULT 'US',
    -- Tracking
    tracking_number  VARCHAR(100),
    carrier          VARCHAR(50),
    shipped_at       TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    cancelled_at     TIMESTAMPTZ,
    cancel_reason    TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   UUID          NOT NULL,
    product_name VARCHAR(255)  NOT NULL,
    sku          VARCHAR(100)  NOT NULL,
    quantity     INTEGER       NOT NULL CHECK (quantity > 0),
    unit_price   NUMERIC(12,2) NOT NULL,
    total_price  NUMERIC(12,2) NOT NULL,
    image_url    TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS order_status_history (
    id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id   UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status     order_status NOT NULL,
    note       TEXT,
    changed_by UUID,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_orders_user      ON orders(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_number    ON orders(order_number)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_ord  ON order_items(order_id)`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const sql of MIGRATIONS) {
      await client.query(sql).catch((e) => {
        // Ignore "already exists" errors for types/indexes
        if (!e.message.includes('already exists')) throw e;
      });
    }
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start  = Date.now();
  const result = await pool.query(text, params);
  logger.debug('DB query', { duration: Date.now() - start, rows: result.rowCount });
  return result;
}

module.exports = { pool, migrate, query };
