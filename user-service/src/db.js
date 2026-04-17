'use strict';

const { Pool } = require('pg');
const logger   = require('./utils/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'userdb',
  user:     process.env.DB_USER     || 'user_svc',
  password: process.env.DB_PASSWORD || 'user_secret',
  max:      20,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PG pool error', { error: err.message });
});

const MIGRATIONS = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

  `CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'customer'
                               CHECK (role IN ('customer','admin','vendor')),
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    is_verified   BOOLEAN      NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS addresses (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label        VARCHAR(50)  NOT NULL DEFAULT 'Home',
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    city         VARCHAR(100) NOT NULL,
    state        VARCHAR(100),
    postal_code  VARCHAR(20)  NOT NULL,
    country      CHAR(2)      NOT NULL DEFAULT 'US',
    is_default   BOOLEAN      NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_addresses_user       ON addresses(user_id)`,
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
  logger.debug('DB query', { text, duration: Date.now() - start, rows: result.rowCount });
  return result;
}

module.exports = { pool, migrate, query };
