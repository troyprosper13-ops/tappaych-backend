const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { normalizePhone } = require('./networkDetector');

const BASE_URL = process.env.GHIPSS_BASE_URL || 'https://api.ghipss.net/v1';
const API_KEY = process.env.GHIPSS_API_KEY;
const MERCHANT_ID = process.env.GHIPSS_MERCHANT_ID;
const CALLBACK_URL = process.env.GHIPSS_CALLBACK_URL;

/**
 * GhIPSS Instant Pay API
 * Handles Telecel Cash and AirtelTigo Money payments
 * through Ghana's national interoperability platform
 */

const ghipssClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Merchant-Id': MERCHANT_ID
  },
  timeout: 30000
});

// Request interceptor for logging
ghipssClient.interceptors.request.use((config) => {
  logger.info('GhIPSS API Request', {
    method: config.method?.toUpperCase(),
    url: config.url
  });
  return config;
});

// Response interceptor for error handling
ghipssClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logger.error('GhIPSS API Error', {
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url
    });
    return Promise.reject(error);
  }
);

/**
 * Map network name to GhIPSS network code
 */
const NETWORK_CODES = {
  Telecel: 'VDF',      // Vodafone/Telecel Ghana
  AirtelTigo: 'ATL'   // AirtelTigo Ghana
};

/**
 * Initiate a payment request via GhIPSS
 * @param {Object} params
 * @returns {string} referenceId
 */
const requestToPay = async ({
  amount,
  currency = 'GHS',
  customerPhone,
  network,
  externalId,
  merchantId,
  description = 'TapPay GH Payment'
}) => {
  const referenceId = uuidv4();
  const normalizedPhone = normalizePhone(customerPhone);
  const networkCode = NETWORK_CODES[network];

  if (!networkCode) {
    throw new Error(`Unsupported network for GhIPSS: ${network}`);
  }

  logger.payment('GhIPSS: Initiating payment request', {
    referenceId,
    network,
    networkCode,
    amount,
    phone: normalizedPhone
  });

  try {
    const response = await ghipssClient.post('/payments/request', {
      transactionId: referenceId,
      externalReference: externalId,
      amount: parseFloat(amount).toFixed(2),
      currency,
      network: networkCode,
      customerMsisdn: normalizedPhone,
      merchantId: MERCHANT_ID,
      callbackUrl: CALLBACK_URL,
      narration: description,
      metadata: {
        merchantCode: merchantId,
        source: 'tappaych_nfc'
      }
    });

    logger.payment('GhIPSS: Payment request sent', {
      referenceId,
      status: response.data.status
    });

    return referenceId;

  } catch (error) {
    const message = error.response?.data?.message || 'GhIPSS payment request failed';
    throw new Error(message);
  }
};

/**
 * Check payment status via GhIPSS
 * @param {string} referenceId
 * @returns {Object}
 */
const getPaymentStatus = async (referenceId) => {
  try {
    const response = await ghipssClient.get(`/payments/${referenceId}/status`);
    const { status, amount, currency, customerMsisdn, failureReason } = response.data;

    // Normalize status to match our internal format
    const statusMap = {
      'SUCCESS': 'successful',
      'FAILED': 'failed',
      'PENDING': 'pending',
      'PROCESSING': 'processing',
      'CANCELLED': 'cancelled'
    };

    return {
      referenceId,
      status: statusMap[status] || status?.toLowerCase(),
      amount: parseFloat(amount),
      currency,
      customerPhone: customerMsisdn,
      failureReason,
      raw: response.data
    };

  } catch (error) {
    throw new Error('Failed to check GhIPSS payment status');
  }
};

/**
 * Validate customer mobile money account
 * @param {string} phone
 * @param {string} network
 * @returns {boolean}
 */
const validateAccount = async (phone, network) => {
  const networkCode = NETWORK_CODES[network];
  if (!networkCode) return false;

  try {
    const normalizedPhone = normalizePhone(phone);
    const response = await ghipssClient.get('/accounts/validate', {
      params: { msisdn: normalizedPhone, network: networkCode }
    });
    return response.data.isActive === true;
  } catch (error) {
    logger.warn('GhIPSS: Account validation failed', { phone, network });
    return false;
  }
};

module.exports = {
  requestToPay,
  getPaymentStatus,
  validateAccount
};
