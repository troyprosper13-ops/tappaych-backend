const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User } = require('../models');
const { detectNetwork, isValidGhanaPhone } = require('../services/networkDetector');
const logger = require('../config/logger');
const { authLimiter } = require('../middleware/rateLimiter');

// Apply stricter rate limiting to auth routes
router.use(authLimiter);

// ─── REGISTER ─────────────────────────────────────────────────────────────────
router.post('/register', [
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['customer', 'merchant']).withMessage('Invalid role')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { fullName, phone, email, password, role = 'customer' } = req.body;

  try {
    // Validate Ghana phone number
    if (!isValidGhanaPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ghana phone number'
      });
    }

    // Check if user already exists
    const existing = await User.findOne({ where: { phone } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    const user = await User.create({
      fullName,
      phone,
      email,
      password,
      role,
      network: detectNetwork(phone)
    });

    const tokens = generateTokens(user);

    await user.update({ refreshToken: tokens.refreshToken });

    logger.info('User registered', { userId: user.id, phone, role });

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: user.toSafeJSON(),
        ...tokens
      }
    });

  } catch (error) {
    logger.error('Registration error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', [
  body('phone').trim().notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { phone, password } = req.body;

  try {
    const user = await User.findOne({ where: { phone } });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is suspended. Contact support.'
      });
    }

    const tokens = generateTokens(user);
    await user.update({
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date()
    });

    logger.info('User logged in', { userId: user.id, phone });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeJSON(),
        ...tokens
      }
    });

  } catch (error) {
    logger.error('Login error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findOne({
      where: { id: decoded.id, refreshToken }
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const tokens = generateTokens(user);
    await user.update({ refreshToken: tokens.refreshToken });

    return res.json({
      success: true,
      data: tokens
    });

  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await User.update(
      { refreshToken: null },
      { where: { refreshToken } }
    );
  }
  return res.json({ success: true, message: 'Logged out successfully' });
});

// ─── UPDATE FCM TOKEN ─────────────────────────────────────────────────────────
router.post('/fcm-token', require('../middleware/auth'), async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) {
    return res.status(400).json({ success: false, message: 'FCM token required' });
  }

  await req.user.update({ fcmToken });
  return res.json({ success: true, message: 'FCM token updated' });
});

// ─── HELPER: Generate JWT tokens ──────────────────────────────────────────────
const generateTokens = (user) => {
  const payload = {
    id: user.id,
    phone: user.phone,
    role: user.role
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );

  return { accessToken, refreshToken };
};

module.exports = router;
