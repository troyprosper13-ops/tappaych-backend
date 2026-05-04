const { v4: uuidv4 } = require('uuid');
const { Transaction, NfcSession, Merchant, User } = require('../models');
const momoService = require('./momoService');
const ghipssService = require('./ghipssService');
const notificationService = require('./notificationService');
const { detectNetwork, getPaymentGateway, isValidGhanaPhone } = require('./networkDetector');
const logger = require('../config/logger');

/**
 * Calculate transaction fee based on amount and network
 * Fees follow MTN MoMo Ghana fee schedule (approximate)
 */
const calculateFee = (amount, network) => {
  // Fee tiers (GHS)
  const feeTiers = [
    { max: 1, fee: 0.00 },
    { max: 5, fee: 0.05 },
    { max: 20, fee: 0.10 },
    { max: 50, fee: 0.25 },
    { max: 100, fee: 0.50 },
    { max: 250, fee: 0.75 },
    { max: 500, fee: 1.00 },
    { max: 1000, fee: 1.50 },
    { max: 5000, fee: 2.00 },
    { max: Infinity, fee: 3.00 }
  ];

  const tier = feeTiers.find(t => amount <= t.max);
  return tier ? tier.fee : 3.00;
};

/**
 * Create an NFC session token for merchant
 * This is what gets written to the NFC tag
 * @param {Object} params
 * @returns {Object} session
 */
const createNfcSession = async ({ merchantId, merchantCode, amount, currency = 'GHS' }) => {
  // Sessions expire after 5 minutes
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const sessionToken = `NFC-${uuidv4()}-${Date.now()}`;

  const session = await NfcSession.create({
    sessionToken,
    merchantId,
    merchantCode,
    amount,
    currency,
    expiresAt,
    status: 'active'
  });

  logger.info('NFC session created', {
    sessionToken: session.sessionToken,
    merchantCode,
    amount,
    expiresAt
  });

  return session;
};

/**
 * Validate an NFC session token
 * Called when customer's phone reads the NFC tag
 * @param {string} sessionToken
 * @returns {Object} session + merchant data
 */
const validateNfcSession = async (sessionToken) => {
  const session = await NfcSession.findOne({
    where: { sessionToken, status: 'active' }
  });

  if (!session) {
    throw new Error('Invalid or expired NFC session');
  }

  if (new Date() > session.expiresAt) {
    await session.update({ status: 'expired' });
    throw new Error('NFC session has expired. Ask merchant to refresh.');
  }

  const merchant = await Merchant.findByPk(session.merchantId);
  if (!merchant || !merchant.isActive) {
    throw new Error('Merchant not found or inactive');
  }

  // Mark session as tapped
  await session.update({ status: 'tapped', tappedAt: new Date() });

  return { session, merchant };
};

/**
 * Initiate a payment after NFC tap
 * Main payment orchestration function
 * @param {Object} params
 * @returns {Object} transaction
 */
const initiatePayment = async ({
  sessionToken,
  customerPhone,
  customerId,
  io // WebSocket instance for real-time updates
}) => {
  // Validate phone number
  if (!isValidGhanaPhone(customerPhone)) {
    throw new Error('Invalid Ghana phone number');
  }

  // Validate NFC session
  const { session, merchant } = await validateNfcSession(sessionToken);

  // Detect network and gateway
  const network = detectNetwork(customerPhone);
  if (network === 'unknown') {
    throw new Error('Could not detect mobile network from phone number');
  }
  const gateway = getPaymentGateway(network);

  // Calculate fees
  const fee = calculateFee(session.amount, network);
  const netAmount = parseFloat(session.amount) - fee;

  // Create transaction record
  const referenceId = `TPG-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;

  const transaction = await Transaction.create({
    referenceId,
    customerId,
    customerPhone,
    merchantId: merchant.id,
    merchantCode: merchant.merchantCode,
    amount: session.amount,
    fee,
    netAmount,
    currency: session.currency,
    network,
    status: 'pending',
    paymentMethod: 'nfc',
    paymentGateway: gateway,
    nfcSessionId: session.sessionToken,
    metadata: {
      sessionToken,
      businessName: merchant.businessName
    }
  });

  logger.payment('Payment initiated', {
    transactionId: transaction.id,
    referenceId,
    network,
    gateway,
    amount: session.amount,
    merchantCode: merchant.merchantCode
  });

  // Notify via WebSocket that payment is processing
  if (io) {
    io.to(`merchant-${merchant.id}`).emit('payment_initiated', {
      transactionId: transaction.id,
      referenceId,
      amount: session.amount,
      customerPhone: customerPhone.slice(0, -4) + '****',
      status: 'pending'
    });
  }

  // Route to correct payment gateway
  let externalReferenceId;
  try {
    await transaction.update({ status: 'processing' });

    if (gateway === 'mtn_momo') {
      externalReferenceId = await momoService.requestToPay({
        amount: session.amount,
        currency: session.currency,
        customerPhone,
        externalId: referenceId,
        payerMessage: `Pay GHS ${session.amount} to ${merchant.businessName}`,
        payeeNote: `TapPay - ${merchant.merchantCode}`
      });
    } else {
      externalReferenceId = await ghipssService.requestToPay({
        amount: session.amount,
        currency: session.currency,
        customerPhone,
        network,
        externalId: referenceId,
        merchantId: merchant.merchantCode
      });
    }

    await transaction.update({ externalReference: externalReferenceId });

    // Link session to transaction
    await session.update({
      transactionId: transaction.id,
      status: 'completed'
    });

    logger.payment('Payment request sent to gateway', {
      referenceId,
      externalReferenceId,
      gateway
    });

    return {
      transactionId: transaction.id,
      referenceId,
      externalReferenceId,
      status: 'processing',
      amount: session.amount,
      currency: session.currency,
      fee,
      network,
      merchantName: merchant.businessName,
      message: `Payment request sent. Please approve on your ${network} phone.`
    };

  } catch (error) {
    await transaction.update({
      status: 'failed',
      failureReason: error.message
    });

    if (io) {
      io.to(`merchant-${merchant.id}`).emit('payment_failed', {
        transactionId: transaction.id,
        referenceId,
        reason: error.message
      });
    }

    throw error;
  }
};

/**
 * Handle confirmed payment (called from webhook)
 * @param {Object} params
 */
const confirmPayment = async ({ referenceId, externalReference, status, gateway, io }) => {
  const transaction = await Transaction.findOne({
    where: { referenceId },
    include: [
      { model: Merchant, as: 'merchant' },
      { model: User, as: 'customer' }
    ]
  });

  if (!transaction) {
    logger.warn('Webhook: Transaction not found', { referenceId });
    return;
  }

  if (transaction.status === 'successful') {
    logger.info('Webhook: Transaction already confirmed', { referenceId });
    return;
  }

  const isSuccess = status === 'successful' || status === 'SUCCESSFUL';

  await transaction.update({
    status: isSuccess ? 'successful' : 'failed',
    completedAt: isSuccess ? new Date() : null,
    failureReason: isSuccess ? null : `Payment ${status} via ${gateway}`
  });

  // Update merchant stats
  if (isSuccess && transaction.merchant) {
    await transaction.merchant.increment({
      totalTransactions: 1,
      totalVolume: parseFloat(transaction.amount)
    });
  }

  logger.payment('Payment confirmed', {
    referenceId,
    status: isSuccess ? 'successful' : 'failed',
    amount: transaction.amount,
    merchantCode: transaction.merchantCode
  });

  // Real-time notifications
  if (io) {
    const merchantRoom = `merchant-${transaction.merchantId}`;
    const customerRoom = `customer-${transaction.customerId}`;

    const eventData = {
      transactionId: transaction.id,
      referenceId,
      status: isSuccess ? 'successful' : 'failed',
      amount: transaction.amount,
      currency: transaction.currency,
      timestamp: new Date().toISOString()
    };

    if (isSuccess) {
      io.to(merchantRoom).emit('payment_successful', {
        ...eventData,
        customerPhone: transaction.customerPhone
      });
      io.to(customerRoom).emit('payment_successful', {
        ...eventData,
        merchantName: transaction.merchant?.businessName
      });
    } else {
      io.to(merchantRoom).emit('payment_failed', eventData);
      io.to(customerRoom).emit('payment_failed', eventData);
    }
  }

  // Push notifications
  if (transaction.customer?.fcmToken) {
    await notificationService.sendPaymentNotification({
      fcmToken: transaction.customer.fcmToken,
      type: isSuccess ? 'payment_success' : 'payment_failed',
      amount: transaction.amount,
      merchantName: transaction.merchant?.businessName
    });
  }

  return transaction;
};

/**
 * Poll payment status (fallback when webhook doesn't arrive)
 * @param {string} transactionId
 * @returns {Object} updated transaction
 */
const pollPaymentStatus = async (transactionId) => {
  const transaction = await Transaction.findByPk(transactionId);

  if (!transaction) throw new Error('Transaction not found');
  if (['successful', 'failed', 'cancelled'].includes(transaction.status)) {
    return transaction;
  }

  let statusData;

  try {
    if (transaction.paymentGateway === 'mtn_momo') {
      statusData = await momoService.getPaymentStatus(transaction.externalReference);
    } else {
      statusData = await ghipssService.getPaymentStatus(transaction.externalReference);
    }

    if (statusData.status !== 'pending' && statusData.status !== 'processing') {
      await transaction.update({
        status: statusData.status,
        completedAt: statusData.status === 'successful' ? new Date() : null,
        failureReason: statusData.reason || null
      });
    }

    return transaction.reload();

  } catch (error) {
    logger.error('Failed to poll payment status', { transactionId, error: error.message });
    throw error;
  }
};

module.exports = {
  createNfcSession,
  validateNfcSession,
  initiatePayment,
  confirmPayment,
  pollPaymentStatus,
  calculateFee
};
