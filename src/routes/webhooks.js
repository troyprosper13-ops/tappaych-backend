const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const paymentService = require('../services/paymentService');
const logger = require('../config/logger');

/**
 * Verify MTN MoMo webhook signature
 */
const verifyMoMoSignature = (req) => {
  // MTN MoMo doesn't use signature verification in sandbox
  // In production, implement their signature scheme
  if (process.env.NODE_ENV !== 'production') return true;

  const signature = req.headers['x-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET);
  const body = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
  const digest = hmac.update(body).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
};

/**
 * Verify GhIPSS webhook signature
 */
const verifyGhIPSSSignature = (req) => {
  if (process.env.NODE_ENV !== 'production') return true;

  const signature = req.headers['x-ghipss-signature'];
  if (!signature) return false;

  const body = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
  const expected = crypto
    .createHmac('sha256', process.env.GHIPSS_API_KEY)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
};

// ─── MTN MOMO WEBHOOK ────────────────────────────────────────────────────────
// MTN calls this URL when a payment is confirmed or fails
router.post('/momo', async (req, res) => {
  // Always respond 200 quickly to MTN
  res.sendStatus(200);

  const body = req.body instanceof Buffer ? JSON.parse(req.body.toString()) : req.body;

  logger.payment('MTN MoMo webhook received', {
    externalId: body.externalId,
    status: body.status,
    amount: body.amount
  });

  if (!verifyMoMoSignature(req)) {
    logger.warn('MTN MoMo: Invalid webhook signature');
    return;
  }

  try {
    const { externalId, status, amount, currency, payer, reason } = body;

    // externalId is the referenceId we sent when creating the payment
    if (!externalId) {
      logger.warn('MTN MoMo webhook: Missing externalId');
      return;
    }

    // Map MTN status to our internal status
    const statusMap = {
      'SUCCESSFUL': 'successful',
      'FAILED': 'failed',
      'PENDING': 'pending',
      'CANCELLED': 'cancelled'
    };

    const io = null; // Can't access io here directly, handle via service
    // In production, use a message queue (Redis/Bull) for this

    await paymentService.confirmPayment({
      referenceId: externalId,
      externalReference: body.financialTransactionId,
      status: statusMap[status] || status?.toLowerCase(),
      gateway: 'mtn_momo',
      io: global.io || null,
      metadata: { payer, reason, raw: body }
    });

  } catch (error) {
    logger.error('MTN MoMo webhook processing error', { error: error.message });
  }
});

// ─── GHIPSS WEBHOOK ───────────────────────────────────────────────────────────
router.post('/ghipss', async (req, res) => {
  // Respond quickly
  res.sendStatus(200);

  const body = req.body instanceof Buffer ? JSON.parse(req.body.toString()) : req.body;

  logger.payment('GhIPSS webhook received', {
    transactionId: body.transactionId,
    status: body.status,
    amount: body.amount
  });

  if (!verifyGhIPSSSignature(req)) {
    logger.warn('GhIPSS: Invalid webhook signature');
    return;
  }

  try {
    const { transactionId, externalReference, status, amount, failureReason } = body;

    const statusMap = {
      'SUCCESS': 'successful',
      'FAILED': 'failed',
      'PENDING': 'pending',
      'REVERSED': 'refunded'
    };

    await paymentService.confirmPayment({
      referenceId: transactionId,
      externalReference,
      status: statusMap[status] || status?.toLowerCase(),
      gateway: 'ghipss',
      io: global.io || null,
      metadata: { failureReason, raw: body }
    });

  } catch (error) {
    logger.error('GhIPSS webhook processing error', { error: error.message });
  }
});

// ─── WEBHOOK TEST (Development only) ─────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  router.post('/test', async (req, res) => {
    const { referenceId, status = 'successful', gateway = 'mtn_momo' } = req.body;

    if (!referenceId) {
      return res.status(400).json({ success: false, message: 'referenceId required' });
    }

    try {
      await paymentService.confirmPayment({
        referenceId,
        status,
        gateway,
        io: global.io || null
      });

      return res.json({
        success: true,
        message: `Test webhook processed: ${referenceId} -> ${status}`
      });

    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
}

module.exports = router;
