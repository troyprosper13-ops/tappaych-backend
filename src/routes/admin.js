const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const { User, Merchant, Transaction } = require('../models');
const { sequelize } = require('../config/database');
const logger = require('../config/logger');

router.use(authenticate, authorize('admin'));

// ─── PLATFORM OVERVIEW STATS ──────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [users, merchants, transactions] = await Promise.all([
      User.count(),
      Merchant.count(),
      Transaction.findAll({
        where: { status: 'successful' },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('amount')), 'volume'],
          [sequelize.fn('AVG', sequelize.col('amount')), 'avgAmount']
        ],
        raw: true
      })
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayTxns = await Transaction.count({
      where: { status: 'successful', createdAt: { [Op.gte]: today } }
    });

    return res.json({
      success: true,
      data: {
        totalUsers: users,
        totalMerchants: merchants,
        transactions: {
          total: parseInt(transactions[0]?.count) || 0,
          volume: parseFloat(transactions[0]?.volume) || 0,
          avgAmount: parseFloat(transactions[0]?.avgAmount) || 0,
          today: todayTxns
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── LIST ALL USERS ───────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { page = 1, limit = 50, role, search } = req.query;
  const where = {};
  if (role) where.role = role;
  if (search) {
    where[Op.or] = [
      { phone: { [Op.iLike]: `%${search}%` } },
      { fullName: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows } = await User.findAndCountAll({
    where,
    attributes: { exclude: ['password', 'refreshToken', 'fcmToken'] },
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit)
  });

  return res.json({
    success: true,
    data: {
      users: rows,
      pagination: { total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) }
    }
  });
});

// ─── VERIFY / SUSPEND USER ────────────────────────────────────────────────────
router.patch('/users/:id', async (req, res) => {
  const { isActive, isVerified, kycStatus } = req.body;
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const updates = {};
  if (isActive !== undefined) updates.isActive = isActive;
  if (isVerified !== undefined) updates.isVerified = isVerified;
  if (kycStatus) updates.kycStatus = kycStatus;

  await user.update(updates);
  logger.info('Admin updated user', { adminId: req.user.id, targetUserId: user.id, updates });

  return res.json({ success: true, data: user.toSafeJSON() });
});

// ─── LIST ALL MERCHANTS ───────────────────────────────────────────────────────
router.get('/merchants', async (req, res) => {
  const { page = 1, limit = 50, isVerified } = req.query;
  const where = {};
  if (isVerified !== undefined) where.isVerified = isVerified === 'true';

  const { count, rows } = await Merchant.findAndCountAll({
    where,
    include: [{ model: User, as: 'owner', attributes: ['fullName', 'phone'] }],
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit)
  });

  return res.json({
    success: true,
    data: {
      merchants: rows,
      pagination: { total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) }
    }
  });
});

// ─── VERIFY MERCHANT ──────────────────────────────────────────────────────────
router.patch('/merchants/:id/verify', async (req, res) => {
  const merchant = await Merchant.findByPk(req.params.id);
  if (!merchant) return res.status(404).json({ success: false, message: 'Merchant not found' });

  await merchant.update({ isVerified: true });
  logger.info('Merchant verified', { adminId: req.user.id, merchantId: merchant.id });

  return res.json({ success: true, message: `${merchant.businessName} verified successfully` });
});

// ─── ALL TRANSACTIONS ─────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  const { page = 1, limit = 50, status, network, gateway } = req.query;
  const where = {};
  if (status) where.status = status;
  if (network) where.network = network;
  if (gateway) where.paymentGateway = gateway;

  const { count, rows } = await Transaction.findAndCountAll({
    where,
    include: [
      { model: Merchant, as: 'merchant', attributes: ['businessName', 'merchantCode'] },
      { model: User, as: 'customer', attributes: ['fullName', 'phone'] }
    ],
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit)
  });

  return res.json({
    success: true,
    data: {
      transactions: rows,
      pagination: { total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) }
    }
  });
});

module.exports = router;
