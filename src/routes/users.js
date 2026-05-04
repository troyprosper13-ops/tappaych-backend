const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { User } = require('../models');

router.use(authenticate);

// GET current user profile
router.get('/me', async (req, res) => {
  return res.json({
    success: true,
    data: req.user.toSafeJSON()
  });
});

// UPDATE profile
router.put('/me', async (req, res) => {
  const allowed = ['fullName', 'email'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f]) updates[f] = req.body[f]; });

  await req.user.update(updates);
  return res.json({ success: true, data: req.user.toSafeJSON() });
});

// UPDATE MoMo number
router.put('/momo-number', async (req, res) => {
  const { momoNumber } = req.body;
  if (!momoNumber) {
    return res.status(400).json({ success: false, message: 'MoMo number required' });
  }
  await req.user.update({ momoNumber });
  return res.json({ success: true, message: 'MoMo number updated' });
});

module.exports = router;
