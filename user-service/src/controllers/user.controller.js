'use strict';

const db = require('../db');

exports.getProfile = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role, is_verified, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.sub],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    res.json({ id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
               role: u.role, isVerified: u.is_verified, createdAt: u.created_at });
  } catch (err) { next(err); }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         updated_at = NOW()
       WHERE id = $3
       RETURNING id, email, first_name, last_name, role`,
      [firstName || null, lastName || null, req.user.sub],
    );
    const u = rows[0];
    res.json({ id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, role: u.role });
  } catch (err) { next(err); }
};

exports.getAddresses = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, label, address_line1, address_line2, city, state, postal_code, country, is_default
       FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [req.user.sub],
    );
    res.json(rows);
  } catch (err) { next(err); }
};

exports.addAddress = async (req, res, next) => {
  try {
    const { label = 'Home', addressLine1, addressLine2, city, state, postalCode, country = 'US', isDefault = false } = req.body;
    if (isDefault) {
      await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.sub]);
    }
    const { rows } = await db.query(
      `INSERT INTO addresses (user_id, label, address_line1, address_line2, city, state, postal_code, country, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.sub, label, addressLine1, addressLine2, city, state, postalCode, country, isDefault],
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
};

exports.deleteAddress = async (req, res, next) => {
  try {
    await db.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.sub]);
    res.status(204).end();
  } catch (err) { next(err); }
};

exports.listUsers = async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page  || '1');
    const limit = parseInt(req.query.limit || '20');
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const total = (await db.query('SELECT COUNT(*) FROM users')).rows[0].count;
    res.json({ data: rows, pagination: { page, limit, total: parseInt(total) } });
  } catch (err) { next(err); }
};

exports.getUserById = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, first_name, last_name, role, is_active, created_at FROM users WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};
