'use strict';

const Stripe = require('stripe');
const logger = require('../utils/logger');
const { publishEvent } = require('../messaging/rabbitmq');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// ── POST /api/v1/payments/intent ──────────────────────────────────────────────
// Creates a Stripe PaymentIntent and returns the client_secret to the frontend
exports.createIntent = async (req, res, next) => {
  try {
    const { orderId, amount, currency = 'usd', metadata = {} } = req.body;

    // amount must be in smallest currency unit (cents for USD)
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (amountCents < 50) {
      return res.status(400).json({ error: 'Amount must be at least $0.50' });
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency,
      metadata: { orderId, userId: req.user.sub, ...metadata },
      automatic_payment_methods: { enabled: true },
    });

    logger.info('PaymentIntent created', { intentId: intent.id, orderId, amount });
    res.status(201).json({
      paymentIntentId: intent.id,
      clientSecret:    intent.client_secret,
      amount:          intent.amount,
      currency:        intent.currency,
      status:          intent.status,
    });
  } catch (err) {
    logger.error('Stripe error creating intent', { error: err.message });
    next(err);
  }
};

// ── POST /api/v1/payments/confirm ─────────────────────────────────────────────
// Called server-side after frontend confirms payment (for server-side confirmation flow)
exports.confirmPayment = async (req, res, next) => {
  try {
    const { paymentIntentId, orderId } = req.body;
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const success = intent.status === 'succeeded';

    await publishEvent(success ? 'payment.completed' : 'payment.failed', {
      orderId,
      paymentIntentId: intent.id,
      amount:   intent.amount,
      currency: intent.currency,
      status:   intent.status,
      userId:   req.user.sub,
    });

    logger.info('Payment confirmed', { intentId: intent.id, status: intent.status, orderId });
    res.json({ status: intent.status, success });
  } catch (err) {
    logger.error('Stripe confirm error', { error: err.message });
    next(err);
  }
};

// ── POST /api/v1/payments/refund ─────────────────────────────────────────────
exports.createRefund = async (req, res, next) => {
  try {
    const { paymentIntentId, amount, reason = 'requested_by_customer' } = req.body;

    const refundParams = { payment_intent: paymentIntentId, reason };
    if (amount) refundParams.amount = Math.round(parseFloat(amount) * 100);

    const refund = await stripe.refunds.create(refundParams);

    await publishEvent('payment.refunded', {
      refundId:        refund.id,
      paymentIntentId,
      amount:          refund.amount,
      status:          refund.status,
    });

    logger.info('Refund created', { refundId: refund.id, paymentIntentId });
    res.json({
      refundId: refund.id,
      amount:   refund.amount,
      status:   refund.status,
      currency: refund.currency,
    });
  } catch (err) {
    logger.error('Stripe refund error', { error: err.message });
    next(err);
  }
};

// ── GET /api/v1/payments/:intentId ───────────────────────────────────────────
exports.getPayment = async (req, res, next) => {
  try {
    const intent = await stripe.paymentIntents.retrieve(req.params.intentId);
    res.json({
      id:       intent.id,
      amount:   intent.amount,
      currency: intent.currency,
      status:   intent.status,
      metadata: intent.metadata,
      created:  new Date(intent.created * 1000).toISOString(),
    });
  } catch (err) {
    if (err.code === 'resource_missing') {
      return res.status(404).json({ error: 'Payment intent not found' });
    }
    next(err);
  }
};

// ── POST /api/v1/webhooks/stripe ─────────────────────────────────────────────
// Stripe calls this endpoint directly – signature verification required
exports.stripeWebhook = async (req, res, next) => {
  const sig     = req.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // req.body must be the raw buffer for signature verification
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    logger.warn('Webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  logger.info('Stripe webhook received', { type: event.type });

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      await publishEvent('payment.completed', {
        orderId:         pi.metadata.orderId,
        paymentIntentId: pi.id,
        amount:          pi.amount,
        currency:        pi.currency,
        status:          pi.status,
      });
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      await publishEvent('payment.failed', {
        orderId:         pi.metadata.orderId,
        paymentIntentId: pi.id,
        status:          pi.status,
      });
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      await publishEvent('payment.refunded', {
        paymentIntentId: charge.payment_intent,
        amount:          charge.amount_refunded,
      });
      break;
    }
    default:
      logger.debug('Unhandled webhook event', { type: event.type });
  }

  res.json({ received: true });
};
