'use strict';

const db     = require('../db');
const logger = require('../utils/logger');
const { publishEvent } = require('../messaging/rabbitmq');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── GET /api/v1/products ───────────────────────────────────────────────────────
exports.listProducts = async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || '1'));
    const limit    = Math.min(100, parseInt(req.query.limit || '20'));
    const offset   = (page - 1) * limit;
    const search   = req.query.search   || '';
    const category = req.query.category || '';
    const minPrice = parseFloat(req.query.minPrice || '0');
    const maxPrice = parseFloat(req.query.maxPrice || '999999999');
    const sort     = req.query.sort || 'created_at_desc';

    const sortMap = {
      price_asc:       'p.price ASC',
      price_desc:      'p.price DESC',
      name_asc:        'p.name ASC',
      created_at_desc: 'p.created_at DESC',
      created_at_asc:  'p.created_at ASC',
    };
    const orderBy = sortMap[sort] || 'p.created_at DESC';

    const conditions = ['p.is_active = true'];
    const params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      conditions.push(`c.slug = $${params.length}`);
    }
    params.push(minPrice); conditions.push(`p.price >= $${params.length}`);
    params.push(maxPrice); conditions.push(`p.price <= $${params.length}`);

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `
      SELECT COUNT(*) FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${where}`;

    const dataSql = `
      SELECT
        p.id, p.name, p.slug, p.sku, p.price, p.compare_price,
        p.description, p.is_featured, p.created_at,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        i.quantity, i.reserved,
        (SELECT url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) AS primary_image
      FROM products p
      LEFT JOIN categories c  ON c.id = p.category_id
      LEFT JOIN inventory  i  ON i.product_id = p.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRes, dataRes] = await Promise.all([
      db.query(countSql, params),
      db.query(dataSql,  [...params, limit, offset]),
    ]);

    res.json({
      data: dataRes.rows,
      pagination: {
        page, limit,
        total: parseInt(countRes.rows[0].count),
        pages: Math.ceil(countRes.rows[0].count / limit),
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/products/featured ─────────────────────────────────────────────
exports.getFeatured = async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name,
         (SELECT url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) AS primary_image
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = true AND p.is_featured = true
       ORDER BY p.updated_at DESC LIMIT 12`,
    );
    res.json(rows);
  } catch (err) { next(err); }
};

// ── GET /api/v1/products/:id ───────────────────────────────────────────────────
exports.getProduct = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*,
         c.name AS category_name, c.slug AS category_slug,
         i.quantity, i.reserved, i.low_stock_alert, i.track_inventory,
         COALESCE(
           json_agg(DISTINCT jsonb_build_object('id', pi.id, 'url', pi.url,
             'altText', pi.alt_text, 'isPrimary', pi.is_primary, 'sortOrder', pi.sort_order))
           FILTER (WHERE pi.id IS NOT NULL), '[]'
         ) AS images,
         COALESCE(
           json_object_agg(pa.key, pa.value)
           FILTER (WHERE pa.id IS NOT NULL), '{}'
         ) AS attributes
       FROM products p
       LEFT JOIN categories          c  ON c.id = p.category_id
       LEFT JOIN inventory           i  ON i.product_id = p.id
       LEFT JOIN product_images      pi ON pi.product_id = p.id
       LEFT JOIN product_attributes  pa ON pa.product_id = p.id
       WHERE p.id = $1 OR p.slug = $1
       GROUP BY p.id, c.id, i.id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ── POST /api/v1/products ──────────────────────────────────────────────────────
exports.createProduct = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const {
      name, description, sku, price, comparePrice, costPrice,
      categoryId, weightGrams, isActive = true, isFeatured = false,
      initialStock = 0, lowStockAlert = 10, attributes = {},
      metaTitle, metaDesc,
    } = req.body;

    const slug = slugify(name);

    const { rows } = await client.query(
      `INSERT INTO products
         (name, slug, description, sku, price, compare_price, cost_price,
          category_id, weight_grams, is_active, is_featured, meta_title, meta_desc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [name, slug, description, sku, price, comparePrice, costPrice,
       categoryId, weightGrams, isActive, isFeatured, metaTitle, metaDesc],
    );

    const product = rows[0];

    // Create inventory record
    await client.query(
      `INSERT INTO inventory (product_id, quantity, low_stock_alert)
       VALUES ($1, $2, $3)`,
      [product.id, initialStock, lowStockAlert],
    );

    // Store attributes
    for (const [key, value] of Object.entries(attributes)) {
      await client.query(
        'INSERT INTO product_attributes (product_id, key, value) VALUES ($1,$2,$3)',
        [product.id, key, String(value)],
      );
    }

    await client.query('COMMIT');

    await publishEvent('product.created', { productId: product.id, name, sku, price });
    logger.info('Product created', { productId: product.id });

    res.status(201).json(product);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── PATCH /api/v1/products/:id ────────────────────────────────────────────────
exports.updateProduct = async (req, res, next) => {
  try {
    const allowed = ['name','description','price','comparePrice','costPrice',
                     'categoryId','isActive','isFeatured','weightGrams','metaTitle','metaDesc'];
    const updates  = [];
    const values   = [];

    const columnMap = {
      name: 'name', description: 'description', price: 'price',
      comparePrice: 'compare_price', costPrice: 'cost_price',
      categoryId: 'category_id', isActive: 'is_active', isFeatured: 'is_featured',
      weightGrams: 'weight_grams', metaTitle: 'meta_title', metaDesc: 'meta_desc',
    };

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        values.push(req.body[key]);
        updates.push(`${columnMap[key]} = $${values.length}`);
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    values.push(new Date(), req.params.id);
    updates.push(`updated_at = $${values.length - 1}`);

    const { rows } = await db.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });

    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/products/:id ───────────────────────────────────────────────
exports.deleteProduct = async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'UPDATE products SET is_active = false WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Product not found' });
    res.status(204).end();
  } catch (err) { next(err); }
};

// ── GET /api/v1/products/:id/inventory ───────────────────────────────────────
exports.getInventory = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM inventory WHERE product_id = $1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Inventory record not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/products/:id/inventory ─────────────────────────────────────
exports.updateInventory = async (req, res, next) => {
  try {
    const { quantity, lowStockAlert } = req.body;
    const { rows } = await db.query(
      `UPDATE inventory SET
         quantity        = COALESCE($1, quantity),
         low_stock_alert = COALESCE($2, low_stock_alert),
         updated_at      = NOW()
       WHERE product_id = $3
       RETURNING *`,
      [quantity ?? null, lowStockAlert ?? null, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Inventory not found' });

    await publishEvent('inventory.updated', { productId: req.params.id, quantity: rows[0].quantity });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// ── POST /api/v1/products/:id/images ─────────────────────────────────────────
exports.addImage = async (req, res, next) => {
  try {
    const { url, altText, sortOrder = 0, isPrimary = false } = req.body;
    if (isPrimary) {
      await db.query('UPDATE product_images SET is_primary = false WHERE product_id = $1', [req.params.id]);
    }
    const { rows } = await db.query(
      `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, url, altText, sortOrder, isPrimary],
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
};
