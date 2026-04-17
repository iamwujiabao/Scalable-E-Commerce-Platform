'use strict';

const express  = require('express');
const { body } = require('express-validator');
const db       = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// GET /api/v1/categories
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = true
       WHERE c.is_active = true
       GROUP BY c.id
       ORDER BY c.name ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/v1/categories/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM categories WHERE slug = $1 OR id = $1', [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/v1/categories  (admin only)
router.post('/',
  authMiddleware, requireRole('admin'),
  [body('name').trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { name, description, parentId, imageUrl } = req.body;
      const slug = slugify(name);
      const { rows } = await db.query(
        `INSERT INTO categories (name, slug, description, parent_id, image_url)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, slug, description, parentId, imageUrl]
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  }
);

// PATCH /api/v1/categories/:id  (admin only)
router.patch('/:id',
  authMiddleware, requireRole('admin'),
  async (req, res, next) => {
    try {
      const { name, description, isActive, imageUrl } = req.body;
      const slug = name ? slugify(name) : undefined;
      const { rows } = await db.query(
        `UPDATE categories SET
           name        = COALESCE($1, name),
           slug        = COALESCE($2, slug),
           description = COALESCE($3, description),
           is_active   = COALESCE($4, is_active),
           image_url   = COALESCE($5, image_url),
           updated_at  = NOW()
         WHERE id = $6 RETURNING *`,
        [name, slug, description, isActive, imageUrl, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Category not found' });
      res.json(rows[0]);
    } catch (err) { next(err); }
  }
);

module.exports = router;
