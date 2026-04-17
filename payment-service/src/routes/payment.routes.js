'use strict';

const express  = require('express');
const { body } = require('express-validator');
const ctrl     = require('../controllers/payment.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

// Stripe webhook – raw body required for signature verification
router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  ctrl.stripeWebhook,
);

// All remaining routes require auth
router.use(authMiddleware);

// POST /api/v1/payments/intent
router.post('/intent',
  [
    body('orderId').notEmpty(),
    body('amount').isFloat({ min: 0.5 }),
    body('currency').optional().isLength({ min: 3, max: 3 }),
  ],
  validate,
  ctrl.createIntent,
);

// POST /api/v1/payments/confirm
router.post('/confirm',
  [
    body('paymentIntentId').notEmpty(),
    body('orderId').notEmpty(),
  ],
  validate,
  ctrl.confirmPayment,
);

// POST /api/v1/payments/refund  (admin only)
router.post('/refund',
  requireRole('admin'),
  [body('paymentIntentId').notEmpty()],
  validate,
  ctrl.createRefund,
);

// GET /api/v1/payments/:intentId
router.get('/:intentId', ctrl.getPayment);

module.exports = router;
