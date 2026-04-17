'use strict';

const express  = require('express');
const { body } = require('express-validator');
const ctrl     = require('../controllers/order.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();
router.use(authMiddleware);

// POST /api/v1/orders  – place a new order
router.post('/',
  [
    body('items').isArray({ min: 1 }),
    body('items.*.productId').isUUID(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('shippingAddress.name').trim().notEmpty(),
    body('shippingAddress.line1').trim().notEmpty(),
    body('shippingAddress.city').trim().notEmpty(),
    body('shippingAddress.postalCode').trim().notEmpty(),
  ],
  validate,
  ctrl.createOrder,
);

// GET /api/v1/orders  – list orders (own or all for admin)
router.get('/', ctrl.listOrders);

// GET /api/v1/orders/:id
router.get('/:id', ctrl.getOrder);

// PATCH /api/v1/orders/:id/status  (admin only)
router.patch('/:id/status',
  requireRole('admin'),
  [body('status').isIn(['confirmed','processing','shipped','delivered','cancelled','refunded'])],
  validate,
  ctrl.updateStatus,
);

// POST /api/v1/orders/:id/cancel
router.post('/:id/cancel', ctrl.cancelOrder);

module.exports = router;
