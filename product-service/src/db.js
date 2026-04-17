'use strict';

const { Pool } = require('pg');
const logger   = require('./utils/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'productdb',
  user:     process.env.DB_USER     || 'product_svc',
  password: process.env.DB_PASSWORD || 'product_secret',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));

const MIGRATIONS = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

  `CREATE TABLE IF NOT EXISTS categories (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    slug        VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    parent_id   UUID         REFERENCES categories(id) ON DELETE SET NULL,
    image_url   TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id   UUID          REFERENCES categories(id) ON DELETE SET NULL,
    name          VARCHAR(255)  NOT NULL,
    slug          VARCHAR(280)  NOT NULL UNIQUE,
    description   TEXT,
    sku           VARCHAR(100)  NOT NULL UNIQUE,
    price         NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    compare_price NUMERIC(12,2) CHECK (compare_price >= 0),
    cost_price    NUMERIC(12,2) CHECK (cost_price >= 0),
    weight_grams  INTEGER       CHECK (weight_grams >= 0),
    is_active     BOOLEAN       NOT NULL DEFAULT true,
    is_featured   BOOLEAN       NOT NULL DEFAULT false,
    meta_title    VARCHAR(255),
    meta_desc     TEXT,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS product_images (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT        NOT NULL,
    alt_text   VARCHAR(255),
    sort_order INTEGER     NOT NULL DEFAULT 0,
    is_primary BOOLEAN     NOT NULL DEFAULT false
  )`,

  `CREATE TABLE IF NOT EXISTS inventory (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID        NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    quantity        INTEGER     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved        INTEGER     NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    low_stock_alert INTEGER     NOT NULL DEFAULT 10,
    track_inventory BOOLEAN     NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS product_attributes (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    key        VARCHAR(100) NOT NULL,
    value      TEXT        NOT NULL,
    UNIQUE(product_id, key)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_slug        ON products(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_products_sku         ON products(sku)`,
  `CREATE INDEX IF NOT EXISTS idx_products_active      ON products(is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_product    ON inventory(product_id)`,

  // Seed default category
  `INSERT INTO categories (name, slug, description)
   VALUES ('General', 'general', 'Default product category')
   ON CONFLICT (slug) DO NOTHING`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const sql of MIGRATIONS) {
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  logger.debug('DB query', { duration: Date.now() - start, rows: result.rowCount });
  return result;
}

module.exports = { pool, migrate, query };
