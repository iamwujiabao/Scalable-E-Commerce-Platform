'use strict';

const nodemailer = require('nodemailer');
const twilio     = require('twilio');
const logger     = require('../utils/logger');

// ── Email transporter (SendGrid SMTP) ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER || 'apikey',
    pass: process.env.SMTP_PASS || '',
  },
});

// ── Twilio SMS client ─────────────────────────────────────────────────────────
const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ── Email templates ───────────────────────────────────────────────────────────
const templates = {
  'user.registered': (data) => ({
    subject: `Welcome to Our Store, ${data.name}!`,
    html: `
      <h1>Welcome, ${data.name}!</h1>
      <p>Thanks for registering. Your account is ready.</p>
      <p>Start shopping now and enjoy free shipping on orders over $50.</p>
      <p>Email: <strong>${data.email}</strong></p>
    `,
  }),

  'order.placed': (data) => ({
    subject: `Order Confirmed – ${data.orderNumber}`,
    html: `
      <h1>Your order is confirmed!</h1>
      <p>Order Number: <strong>${data.orderNumber}</strong></p>
      <p>Total: <strong>$${(data.total / 100).toFixed(2)}</strong></p>
      <p>We'll send you another email when your order ships.</p>
      <h3>Items:</h3>
      <ul>
        ${(data.items || []).map((i) =>
          `<li>${i.productName} × ${i.quantity} — $${i.unitPrice}</li>`
        ).join('')}
      </ul>
    `,
  }),

  'order.shipped': (data) => ({
    subject: `Your Order ${data.orderNumber} Has Shipped!`,
    html: `
      <h1>Great news – your order is on the way!</h1>
      <p>Order: <strong>${data.orderNumber}</strong></p>
      ${data.trackingNumber
        ? `<p>Tracking: <strong>${data.trackingNumber}</strong> via ${data.carrier}</p>`
        : ''}
    `,
  }),

  'order.delivered': (data) => ({
    subject: `Order ${data.orderNumber} Delivered`,
    html: `
      <h1>Your order has been delivered!</h1>
      <p>Order: <strong>${data.orderNumber}</strong></p>
      <p>We hope you love it. Leave a review to let us know.</p>
    `,
  }),

  'order.cancelled': (data) => ({
    subject: `Order ${data.orderNumber} Cancelled`,
    html: `
      <h1>Your order has been cancelled</h1>
      <p>Order: <strong>${data.orderNumber}</strong></p>
      <p>If you paid, a refund will be processed within 5-10 business days.</p>
    `,
  }),

  'payment.completed': (data) => ({
    subject: `Payment Received – Order ${data.orderNumber || ''}`,
    html: `
      <h1>Payment Successful</h1>
      <p>Amount: <strong>$${(data.amount / 100).toFixed(2)} ${data.currency?.toUpperCase()}</strong></p>
      <p>Reference: ${data.paymentIntentId}</p>
    `,
  }),
};

// ── SMS templates ─────────────────────────────────────────────────────────────
const smsTemplates = {
  'order.placed':    (d) => `Your order ${d.orderNumber} is confirmed! Total: $${d.total}`,
  'order.shipped':   (d) => `Order ${d.orderNumber} shipped! Tracking: ${d.trackingNumber || 'N/A'}`,
  'order.delivered': (d) => `Your order ${d.orderNumber} has been delivered. Enjoy!`,
};

// ── Senders ───────────────────────────────────────────────────────────────────
async function sendEmail(to, eventType, data) {
  const template = templates[eventType];
  if (!template) {
    logger.debug('No email template for event', { eventType });
    return;
  }

  const { subject, html } = template(data);

  try {
    const info = await transporter.sendMail({
      from:    process.env.FROM_EMAIL || 'noreply@yourstore.com',
      to,
      subject,
      html,
    });
    logger.info('Email sent', { eventType, to, messageId: info.messageId });
  } catch (err) {
    logger.error('Email send failed', { eventType, to, error: err.message });
  }
}

async function sendSMS(to, eventType, data) {
  if (!twilioClient || !to) return;

  const template = smsTemplates[eventType];
  if (!template) return;

  const body = template(data);
  try {
    const msg = await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER,
      to,
    });
    logger.info('SMS sent', { eventType, to, sid: msg.sid });
  } catch (err) {
    logger.error('SMS send failed', { eventType, to, error: err.message });
  }
}

module.exports = { sendEmail, sendSMS };
