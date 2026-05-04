const rateLimit = require('express-rate-limit');

const createLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ success: false, message });
    }
  });

// General API - 100 requests per 15 minutes
const generalLimiter = createLimiter(
  15 * 60 * 1000,
  100,
  'Too many requests. Please slow down.'
);

// Auth endpoints - 10 attempts per 15 minutes
const authLimiter = createLimiter(
  15 * 60 * 1000,
  10,
  'Too many login attempts. Please wait 15 minutes.'
);

// Payment endpoints - 20 per minute
const paymentLimiter = createLimiter(
  60 * 1000,
  20,
  'Too many payment requests. Please wait a moment.'
);

module.exports = { generalLimiter, authLimiter, paymentLimiter };
