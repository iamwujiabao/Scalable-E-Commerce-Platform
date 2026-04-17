'use strict';

const express  = require('express');
const axios    = require('axios');
const { body } = require('express-validator');
const { getCart, saveCart, clearCart } = require('../redis');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate }       = require('../middleware/validate.middleware');
const logger             = require('../utils/logger');

const router = express.Router();

const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';

// Fetch product details to validate price & availability
async function fetchProduct(productId) {
  const { data } = await axios.get(`${PRODUCT_URL}/api/v1/products/${productId}`, { timeout: 5000 });
  return data;
}

// All cart endpoints require auth
router.use(authMiddleware);

// GET /api/v1/cart  – retrieve current user's cart
router.get('/', async (req, res, next) => {
  try {
    const cart = await getCart(req.user.sub);
    res.json(cart);
  } catch (err) { next(err); }
});

// POST /api/v1/cart/items  – add item
router.post('/items',
  [
    body('productId').isUUID(),
    body('quantity').isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { productId, quantity } = req.body;

      // Validate product exists & has stock
      let product;
      try {
        product = await fetchProduct(productId);
      } catch {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (!product.is_active) return res.status(400).json({ error: 'Product is not available' });

      const availableQty = product.track_inventory !== false
        ? (product.quantity ?? 0)
        : Infinity;

      const cart  = await getCart(req.user.sub);
      const idx   = cart.items.findIndex((i) => i.productId === productId);
      const existing = idx >= 0 ? cart.items[idx].quantity : 0;

      if (existing + quantity > availableQty) {
        return res.status(400).json({
          error: `Only ${availableQty - existing} units available`,
        });
      }

      if (idx >= 0) {
        cart.items[idx].quantity += quantity;
        cart.items[idx].price    = product.price; // refresh price
      } else {
        cart.items.push({
          productId,
          name:       product.name,
          sku:        product.sku,
          price:      parseFloat(product.price),
          quantity,
          imageUrl:   product.primary_image || null,
        });
      }

      cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      const saved   = await saveCart(req.user.sub, cart);

      logger.info('Item added to cart', { userId: req.user.sub, productId });
      res.status(201).json(saved);
    } catch (err) { next(err); }
  }
);

// PATCH /api/v1/cart/items/:productId  – update quantity
router.patch('/items/:productId',
  [body('quantity').isInt({ min: 0, max: 100 })],
  validate,
  async (req, res, next) => {
    try {
      const { productId } = req.params;
      const { quantity }  = req.body;
      const cart  = await getCart(req.user.sub);
      const idx   = cart.items.findIndex((i) => i.productId === productId);

      if (idx === -1) return res.status(404).json({ error: 'Item not in cart' });

      if (quantity === 0) {
        cart.items.splice(idx, 1);
      } else {
        cart.items[idx].quantity = quantity;
      }

      cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      const saved   = await saveCart(req.user.sub, cart);
      res.json(saved);
    } catch (err) { next(err); }
  }
);

// DELETE /api/v1/cart/items/:productId  – remove item
router.delete('/items/:productId', async (req, res, next) => {
  try {
    const cart = await getCart(req.user.sub);
    cart.items = cart.items.filter((i) => i.productId !== req.params.productId);
    cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const saved = await saveCart(req.user.sub, cart);
    res.json(saved);
  } catch (err) { next(err); }
});

// DELETE /api/v1/cart  – clear cart
router.delete('/', async (req, res, next) => {
  try {
    await clearCart(req.user.sub);
    res.json({ message: 'Cart cleared' });
  } catch (err) { next(err); }
});

// POST /api/v1/cart/checkout-summary  – price summary before ordering
router.get('/checkout-summary', async (req, res, next) => {
  try {
    const cart     = await getCart(req.user.sub);
    const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const tax      = subtotal * 0.08; // 8% tax
    const shipping = subtotal > 50 ? 0 : 5.99;
    res.json({
      items:    cart.items,
      subtotal: +subtotal.toFixed(2),
      tax:      +tax.toFixed(2),
      shipping: +shipping.toFixed(2),
      total:    +(subtotal + tax + shipping).toFixed(2),
    });
  } catch (err) { next(err); }
});

module.exports = router;
