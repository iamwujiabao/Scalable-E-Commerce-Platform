'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const logger  = require('../utils/logger');
const { publishEvent } = require('../messaging/rabbitmq');

const JWT_SECRET     = process.env.JWT_SECRET     || 'dev_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_DAYS = 7;

function generateTokens(user) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  const accessToken  = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(64).toString('hex');
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, rawToken) {
  const hash    = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400_000);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expires],
  );
}

// POST /api/v1/auth/register
exports.register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email, passwordHash, firstName, lastName],
    );

    const user = rows[0];
    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user.id, refreshToken);

    await publishEvent('user.registered', {
      userId: user.id,
      email:  user.email,
      name:   `${user.first_name} ${user.last_name}`,
    });

    logger.info('User registered', { userId: user.id });

    return res.status(201).json({
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.first_name,
        lastName:  user.last_name,
        role:      user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await db.query(
      `SELECT id, email, password_hash, first_name, last_name, role, is_active
       FROM users WHERE email = $1`,
      [email],
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user.id, refreshToken);

    logger.info('User logged in', { userId: user.id });

    return res.json({
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.first_name,
        lastName:  user.last_name,
        role:      user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/refresh
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await db.query(
      `SELECT rt.id, rt.user_id, rt.expires_at,
              u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [hash],
    );

    const record = rows[0];
    if (!record || !record.is_active || new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Rotate token
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [record.id]);
    const user = { id: record.user_id, email: record.email, role: record.role };
    const tokens = generateTokens(user);
    await storeRefreshToken(user.id, tokens.refreshToken);

    return res.json(tokens);
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
    }
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/auth/me
exports.me = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role, is_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.sub],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    const u = rows[0];
    return res.json({
      id:         u.id,
      email:      u.email,
      firstName:  u.first_name,
      lastName:   u.last_name,
      role:       u.role,
      isVerified: u.is_verified,
      createdAt:  u.created_at,
    });
  } catch (err) {
    next(err);
  }
};
