const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const { Merchant, User } = require('../models');
const { detectNetwork, isValidGhanaPhone } = require('../services/networkDetector');
const logger = require('../config/logger');

router.use(authenticate);

// ─── REGISTER AS MERCHANT ─────────────────────────────────────────────────────
router.post('/register', [
  body('businessName').trim().notEmpty().withMessage('Business name is required'),
  body('businessType').isIn([
    'retail', 'food_beverage', 'transport',
    'services', 'healthcare', 'education', 'other'
  ]).withMessage('Invalid business type'),
  body('momoNumber').notEmpty().withMessage('MoMo number required'),
  body('address').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    // Check if user already has a merchant profile
    const existing = await Merchant.findOne({ where: { userId: req.user.id } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Merchant profile already exists'
      });
    }

    const { businessName, businessType, momoNumber, address, region } = req.body;

    if (!isValidGhanaPhone(momoNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid MoMo number'
      });
    }

    // Generate unique merchant code
    const merchantCode = await generateMerchantCode(businessName);

    const merchant = await Merchant.create({
      userId: req.user.id,
      merchantCode,
      businessName,
      businessType,
      ownerPhone: req.user.phone,
      momoNumber,
      network: detectNetwork(momoNumber),
      address,
      region
    });

    // Update user role to merchant
    await req.user.update({ role: 'merchant' });

    logger.info('Merchant registered', {
      merchantId: merchant.id,
      merchantCode,
      businessName
    });

    return res.status(201).json({
      success: true,
      message: 'Merchant profile created. Pending verification.',
      data: merchant
    });

  } catch (error) {
    logger.error('Merchant registration error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET MY MERCHANT PROFILE ──────────────────────────────────────────────────
router.get('/me', authorize('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await Merchant.findOne({
      where: { userId: req.user.id },
      include: [{ model: User, as: 'owner', attributes: ['fullName', 'phone', 'email'] }]
    });

    if (!merchant) {
      return res.status(404).json({ success: false, message: 'Merchant profile not found' });
    }

    return res.json({ success: true, data: merchant });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── UPDATE MERCHANT PROFILE ──────────────────────────────────────────────────
router.put('/me', authorize('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await Merchant.findOne({ where: { userId: req.user.id } });
    if (!merchant) {
      return res.status(404).json({ success: false, message: 'Merchant profile not found' });
    }

    const allowedUpdates = ['businessName', 'address', 'region', 'businessType'];
    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    await merchant.update(updates);

    return res.json({
      success: true,
      message: 'Merchant profile updated',
      data: merchant
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET MERCHANT DASHBOARD STATS ────────────────────────────────────────────
router.get('/dashboard', authorize('merchant', 'admin'), async (req, res) => {
  try {
    const merchant = await Merchant.findOne({ where: { userId: req.user.id } });
    if (!merchant) {
      return res.status(404).json({ success: false, message: 'Merchant not found' });
    }

    const { Transaction } = require('../models');
    const { Op } = require('sequelize');
    const { sequelize } = require('../config/database');

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayStats, weekStats, monthStats] = await Promise.all([
      Transaction.findAll({
        where: { merchantId: merchant.id, status: 'successful', createdAt: { [Op.gte]: today } },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('amount')), 'volume']
        ],
        raw: true
      }),
      Transaction.findAll({
        where: {
          merchantId: merchant.id,
          status: 'successful',
          createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('amount')), 'volume']
        ],
        raw: true
      }),
      Transaction.findAll({
        where: {
          merchantId: merchant.id,
          status: 'successful',
          createdAt: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('amount')), 'volume']
        ],
        raw: true
      })
    ]);

    return res.json({
      success: true,
      data: {
        merchant: {
          merchantCode: merchant.merchantCode,
          businessName: merchant.businessName,
          isVerified: merchant.isVerified
        },
        stats: {
          today: {
            transactions: parseInt(todayStats[0]?.count) || 0,
            volume: parseFloat(todayStats[0]?.volume) || 0
          },
          week: {
            transactions: parseInt(weekStats[0]?.count) || 0,
            volume: parseFloat(weekStats[0]?.volume) || 0
          },
          month: {
            transactions: parseInt(monthStats[0]?.count) || 0,
            volume: parseFloat(monthStats[0]?.volume) || 0
          },
          allTime: {
            transactions: merchant.totalTransactions,
            volume: parseFloat(merchant.totalVolume)
          }
        }
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── LOOKUP MERCHANT (Public - for NFC validation) ────────────────────────────
router.get('/lookup/:merchantCode', async (req, res) => {
  try {
    const merchant = await Merchant.findOne({
      where: { merchantCode: req.params.merchantCode, isActive: true },
      attributes: ['merchantCode', 'businessName', 'businessType', 'region', 'isVerified']
    });

    if (!merchant) {
      return res.status(404).json({ success: false, message: 'Merchant not found' });
    }

    return res.json({ success: true, data: merchant });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── HELPER: Generate unique merchant code ─────────────────────────────────────
const generateMerchantCode = async (businessName) => {
  const prefix = businessName
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');

  let code;
  let exists = true;

  while (exists) {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    code = `GH-${prefix}-${suffix}`;
    const found = await Merchant.findOne({ where: { merchantCode: code } });
    exists = !!found;
  }

  return code;
};

module.exports = router;
