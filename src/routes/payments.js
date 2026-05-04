const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const { isValidGhanaPhone } = require('../services/networkDetector');
const logger = require('../config/logger');
const { paymentLimiter } = require('../middleware/rateLimiter');

// All payment routes require authentication
router.use(authenticate);

// ─── CREATE NFC SESSION (Merchant) ────────────────────────────────────────────
// Merchant calls this to generate a session token to write to NFC
router.post('/nfc-session', [
  authorize('merchant', 'admin'),
  paymentLimiter,
  body('amount')
    .isFloat({ min: 0.01, max: 10000 })
    .withMessage('Amount must be between 0.01 and 10,000 GHS'),
  body('currency').optional().isIn(['GHS']).withMessage('Only GHS supported')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const merchant = await req.user.getMerchantProfile();
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found. Please complete merchant onboarding.'
      });
    }

    if (!merchant.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Merchant account not yet verified'
      });
    }

    const session = await paymentService.createNfcSession({
      merchantId: merchant.id,
      merchantCode: merchant.merchantCode,
      amount: req.body.amount,
      currency: req.body.currency || 'GHS'
    });

    return res.status(201).json({
      success: true,
      data: {
        sessionToken: session.sessionToken,
        merchantCode: merchant.merchantCode,
        businessName: merchant.businessName,
        amount: session.amount,
        currency: session.currency,
        expiresAt: session.expiresAt,
        // This is the full payload to encode in NFC
        nfcPayload: {
          sessionToken: session.sessionToken,
          merchantCode: merchant.merchantCode,
          businessName: merchant.businessName,
          amount: session.amount,
          currency: session.currency,
          expiresAt: session.expiresAt
        }
      }
    });

  } catch (error) {
    logger.error('Create NFC session error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── INITIATE PAYMENT (Customer) ─────────────────────────────────────────────
// Called after customer's phone reads NFC tag
router.post('/initiate', [
  paymentLimiter,
  body('sessionToken').notEmpty().withMessage('NFC session token required'),
  body('customerPhone').notEmpty().withMessage('Customer phone required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { sessionToken, customerPhone } = req.body;

  try {
    if (!isValidGhanaPhone(customerPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ghana phone number'
      });
    }

    const io = req.app.get('io');

    const result = await paymentService.initiatePayment({
      sessionToken,
      customerPhone,
      customerId: req.user.id,
      io
    });

    return res.status(202).json({
      success: true,
      message: result.message,
      data: result
    });

  } catch (error) {
    logger.error('Initiate payment error', { error: error.message });

    // Return user-friendly error messages
    const userErrors = {
      'Invalid or expired NFC session': 400,
      'NFC session has expired': 400,
      'Merchant not found or inactive': 404,
      'Invalid Ghana phone number': 400,
      'Could not detect mobile network': 400
    };

    const statusCode = Object.entries(userErrors)
      .find(([key]) => error.message.includes(key))?.[1] || 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message
    });
  }
});

// ─── POLL PAYMENT STATUS ──────────────────────────────────────────────────────
router.get('/status/:transactionId', async (req, res) => {
  try {
    const transaction = await paymentService.pollPaymentStatus(req.params.transactionId);

    return res.json({
      success: true,
      data: {
        transactionId: transaction.id,
        referenceId: transaction.referenceId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        network: transaction.network,
        completedAt: transaction.completedAt,
        failureReason: transaction.failureReason
      }
    });

  } catch (error) {
    return res.status(404).json({ success: false, message: error.message });
  }
});

// ─── CANCEL NFC SESSION (Merchant) ───────────────────────────────────────────
router.delete('/nfc-session/:sessionToken', authorize('merchant', 'admin'), async (req, res) => {
  try {
    const { NfcSession } = require('../models');
    const session = await NfcSession.findOne({
      where: { sessionToken: req.params.sessionToken }
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    await session.update({ status: 'cancelled' });

    return res.json({ success: true, message: 'NFC session cancelled' });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
