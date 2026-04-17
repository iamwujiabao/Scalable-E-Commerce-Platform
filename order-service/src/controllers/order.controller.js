'use strict';

const axios  = require('axios');
const db     = require('../db');
const logger = require('../utils/logger');
const { publishEvent } = require('../messaging/rabbitmq');

const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3005';

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateOrderNumber() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

async function fetchProduct(id) {
  const { data } = await axios.get(`${PRODUCT_URL}/api/v1/products/${id}`, { timeout: 5000 });
  return data;
}

// ── POST /api/v1/orders ───────────────────────────────────────────────────────
exports.createOrder = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { items, shippingAddress, notes, couponCode } = req.body;
    const userId = req.user.sub;

    // Validate all products and build line items
    const lineItems = [];
    for (const item of items) {
      let product;
      try {
        product = await fetchProduct(item.productId);
      } catch {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product ${item.productId} not found` });
      }

      if (!product.is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product "${product.name}" is unavailable` });
      }

      const available = product.track_inventory !== false
        ? (product.quantity ?? 0)
        : Infinity;

      if (item.quantity > available) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for "${product.name}". Available: ${available}`,
        });
      }

      lineItems.push({
        productId:   product.id,
        productName: product.name,
        sku:         product.sku,
        quantity:    item.quantity,
        unitPrice:   parseFloat(product.price),
        totalPrice:  parseFloat(product.price) * item.quantity,
        imageUrl:    product.primary_image || null,
      });
    }

    const subtotal     = lineItems.reduce((s, i) => s + i.totalPrice, 0);
    const tax          = +(subtotal * 0.08).toFixed(2);
    const shippingCost = subtotal > 50 ? 0 : 5.99;
    const discount     = 0; // coupon logic can extend here
    const total        = +(subtotal + tax + shippingCost - discount).toFixed(2);

    const orderNumber = generateOrderNumber();
    const { rows } = await client.query(
      `INSERT INTO orders (
         user_id, order_number, subtotal, tax, shipping_cost, discount, total, notes,
         ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        userId, orderNumber, subtotal, tax, shippingCost, discount, total, notes,
        shippingAddress.name, shippingAddress.line1, shippingAddress.line2 || null,
        shippingAddress.city, shippingAddress.state || null,
        shippingAddress.postalCode, shippingAddress.country || 'US',
      ],
    );
    const order = rows[0];

    // Insert order items
    for (const li of lineItems) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, sku, quantity, unit_price, total_price, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, li.productId, li.productName, li.sku,
         li.quantity, li.unitPrice, li.totalPrice, li.imageUrl],
      );
    }

    // Initial status history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'pending', 'Order created', $2)`,
      [order.id, userId],
    );

    await client.query('COMMIT');

    // Publish event for inventory reservation & notifications
    await publishEvent('order.placed', {
      orderId:     order.id,
      orderNumber: order.order_number,
      userId,
      items:       lineItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      total,
    });

    logger.info('Order created', { orderId: order.id, orderNumber, userId, total });

    res.status(201).json({
      ...order,
      items: lineItems,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── GET /api/v1/orders ────────────────────────────────────────────────────────
exports.listOrders = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const page    = Math.max(1, parseInt(req.query.page  || '1'));
    const limit   = Math.min(50, parseInt(req.query.limit || '10'));
    const offset  = (page - 1) * limit;
    const status  = req.query.status || '';

    const params = isAdmin ? [] : [req.user.sub];
    const where  = isAdmin
      ? status ? `WHERE o.status = $${params.push(status)}` : ''
      : `WHERE o.user_id = $1${status ? ` AND o.status = $${params.push(status)}` : ''}`;

    const { rows } = await db.query(
      `SELECT o.*,
         COALESCE(
           json_agg(json_build_object(
             'productId', oi.product_id, 'name', oi.product_name,
             'sku', oi.sku, 'quantity', oi.quantity,
             'unitPrice', oi.unit_price, 'totalPrice', oi.total_price,
             'imageUrl', oi.image_url
           )), '[]'
         ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params,
    );

    const countParams = isAdmin
      ? (status ? [status] : [])
      : (status ? [req.user.sub, status] : [req.user.sub]);
    const countWhere = isAdmin
      ? (status ? 'WHERE status = $1' : '')
      : `WHERE user_id = $1${status ? ' AND status = $2' : ''}`;
    const countRes = await db.query(`SELECT COUNT(*) FROM orders ${countWhere}`, countParams);

    res.json({
      data: rows,
      pagination: { page, limit, total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/orders/:id ────────────────────────────────────────────────────
exports.getOrder = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*,
         COALESCE(
           json_agg(DISTINCT jsonb_build_object(
             'productId', oi.product_id, 'name', oi.product_name,
             'sku', oi.sku, 'quantity', oi.quantity,
             'unitPrice', oi.unit_price, 'totalPrice', oi.total_price,
             'imageUrl', oi.image_url
           )), '[]'
         ) AS items,
         COALESCE(
           json_agg(DISTINCT jsonb_build_object(
             'status', sh.status, 'note', sh.note, 'createdAt', sh.created_at
           )) FILTER (WHERE sh.id IS NOT NULL), '[]'
         ) AS status_history
       FROM orders o
       LEFT JOIN order_items          oi ON oi.order_id = o.id
       LEFT JOIN order_status_history sh ON sh.order_id = o.id
       WHERE o.id = $1 OR o.order_number = $1
       GROUP BY o.id`,
      [req.params.id],
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    // Non-admins can only see their own orders
    if (req.user.role !== 'admin' && order.user_id !== req.user.sub) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(order);
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/orders/:id/status ──────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { status, note, trackingNumber, carrier } = req.body;

    const extra = {};
    if (status === 'shipped') {
      extra.shipped_at      = new Date();
      extra.tracking_number = trackingNumber;
      extra.carrier         = carrier;
    }
    if (status === 'delivered') extra.delivered_at = new Date();
    if (status === 'cancelled') {
      extra.cancelled_at = new Date();
      extra.cancel_reason = note;
    }

    const setClauses = [`status = $1`, `updated_at = NOW()`];
    const vals       = [status];
    for (const [k, v] of Object.entries(extra)) {
      vals.push(v);
      setClauses.push(`${k} = $${vals.length}`);
    }
    vals.push(req.params.id);

    const { rows } = await client.query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found' }); }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, status, note || null, req.user.sub],
    );

    await client.query('COMMIT');

    await publishEvent(`order.${status}`, {
      orderId:     rows[0].id,
      orderNumber: rows[0].order_number,
      userId:      rows[0].user_id,
      status,
      trackingNumber: trackingNumber || null,
      carrier:        carrier || null,
    });

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── POST /api/v1/orders/:id/cancel ───────────────────────────────────────────
exports.cancelOrder = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    if (req.user.role !== 'admin' && order.user_id !== req.user.sub) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order in status: ${order.status}` });
    }

    req.body.status = 'cancelled';
    req.body.note   = req.body.reason || 'Cancelled by customer';
    return exports.updateStatus(req, res, next);
  } catch (err) { next(err); }
};

// ── Called by RabbitMQ consumer ───────────────────────────────────────────────
exports.updateOrderPayment = async ({ orderId, paymentIntentId }, success) => {
  const newPaymentStatus = success ? 'paid'   : 'failed';
  const newOrderStatus   = success ? 'confirmed' : 'pending';

  await db.query(
    `UPDATE orders SET
       payment_status = $1,
       status         = $2,
       payment_intent = $3,
       updated_at     = NOW()
     WHERE id = $4`,
    [newPaymentStatus, newOrderStatus, paymentIntentId, orderId],
  );

  await db.query(
    `INSERT INTO order_status_history (order_id, status, note)
     VALUES ($1, $2, $3)`,
    [orderId, newOrderStatus, `Payment ${newPaymentStatus}`],
  );
};
