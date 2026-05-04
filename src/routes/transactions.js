const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const { Transaction, Merchant, User } = require('../models');

router.use(authenticate);

// ─── GET MY TRANSACTIONS (Customer) ──────────────────────────────────────────
router.get('/my', async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate,
    method
  } = req.query;

  const where = { customerId: req.user.id };

  if (status) where.status = status;
  if (method) where.paymentMethod = method;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate);
  }

  try {
    const { count, rows } = await Transaction.findAndCountAll({
      where,
      include: [{ model: Merchant, as: 'merchant', attributes: ['businessName', 'merchantCode'] }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    return res.json({
      success: true,
      data: {
        transactions: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          pages: Math.ceil(count / parseInt(limit)),
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET MERCHANT TRANSACTIONS ────────────────────────────────────────────────
router.get('/merchant', authorize('merchant', 'admin'), async (req, res) => {
  const { page = 1, limit = 20, status, startDate, endDate } = req.query;

  try {
    const merchant = await req.user.getMerchantProfile();
    if (!merchant) {
      return res.status(404).json({ success: false, message: 'Merchant profile not found' });
    }

    const where = { merchantId: merchant.id };
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    // Calculate summary stats
    const successful = rows.filter(t => t.status === 'successful');
    const totalVolume = successful.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    return res.json({
      success: true,
      data: {
        transactions: rows,
        summary: {
          totalCount: count,
          successfulCount: successful.length,
          totalVolume: totalVolume.toFixed(2),
          currency: 'GHS'
        },
        pagination: {
          total: count,
          page: parseInt(page),
          pages: Math.ceil(count / parseInt(limit))
        }
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET SINGLE TRANSACTION ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findByPk(req.params.id, {
      include: [
        { model: Merchant, as: 'merchant', attributes: ['businessName', 'merchantCode', 'region'] },
        { model: User, as: 'customer', attributes: ['fullName', 'phone'] }
      ]
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Only allow access to own transactions (or admin)
    const isOwner = transaction.customerId === req.user.id;
    const isMerchantOwner = transaction.merchant?.userId === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isMerchantOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.json({ success: true, data: transaction });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
