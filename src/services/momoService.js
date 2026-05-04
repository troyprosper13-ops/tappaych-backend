const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { formatForMoMo } = require('./networkDetector');

const BASE_URL = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = process.env.MTN_COLLECTION_SUBSCRIPTION_KEY;
const TARGET_ENV = process.env.MTN_TARGET_ENV || 'sandbox';
const CALLBACK_URL = process.env.MTN_CALLBACK_URL;

// Token cache to avoid requesting a new token every time
let tokenCache = {
  token: null,
  expiresAt: null
};

/**
 * Get MTN MoMo OAuth2 access token
 * Caches token until expiry
 */
const getAccessToken = async () => {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(
    `${process.env.MTN_COLLECTION_API_USER}:${process.env.MTN_COLLECTION_API_KEY}`
  ).toString('base64');

  try {
    const response = await axios.post(
      `${BASE_URL}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const { access_token, expires_in } = response.data;

    tokenCache = {
      token: access_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };

    logger.info('MTN MoMo: Access token refreshed');
    return access_token;

  } catch (error) {
    logger.error('MTN MoMo: Failed to get access token', {
      status: error.response?.status,
      error: error.response?.data
    });
    throw new Error('Failed to authenticate with MTN MoMo API');
  }
};

/**
 * Request payment from a customer (Collections API)
 * @param {Object} params
 * @param {number} params.amount
 * @param {string} params.currency - Default 'GHS'
 * @param {string} params.customerPhone
 * @param {string} params.externalId - Your transaction reference
 * @param {string} params.payerMessage
 * @param {string} params.payeeNote
 * @returns {string} referenceId - MTN's reference for this request
 */
const requestToPay = async ({
  amount,
  currency = 'GHS',
  customerPhone,
  externalId,
  payerMessage = 'TapPay GH Payment',
  payeeNote = 'TapPay GH Payment'
}) => {
  const token = await getAccessToken();
  const referenceId = uuidv4();
  const formattedPhone = formatForMoMo(customerPhone);

  logger.payment('MTN MoMo: Initiating request to pay', {
    referenceId,
    externalId,
    amount,
    currency,
    phone: formattedPhone
  });

  try {
    await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: amount.toString(),
        currency,
        externalId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: formattedPhone
        },
        payerMessage,
        payeeNote
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': TARGET_ENV,
          'X-Callback-Url': CALLBACK_URL,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.payment('MTN MoMo: Request to pay sent', { referenceId });
    return referenceId;

  } catch (error) {
    logger.error('MTN MoMo: Request to pay failed', {
      referenceId,
      status: error.response?.status,
      error: error.response?.data
    });
    throw new Error(
      error.response?.data?.message || 'MTN MoMo payment request failed'
    );
  }
};

/**
 * Check the status of a payment request
 * @param {string} referenceId - The MTN reference ID from requestToPay
 * @returns {Object} - { status, amount, currency, payer, ... }
 */
const getPaymentStatus = async (referenceId) => {
  const token = await getAccessToken();

  try {
    const response = await axios.get(
      `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': TARGET_ENV,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
        }
      }
    );

    const { status, amount, currency, payer, reason } = response.data;

    logger.info('MTN MoMo: Payment status checked', { referenceId, status });

    return {
      referenceId,
      status: status?.toLowerCase(), // SUCCESSFUL -> successful
      amount: parseFloat(amount),
      currency,
      payer,
      reason,
      raw: response.data
    };

  } catch (error) {
    logger.error('MTN MoMo: Status check failed', {
      referenceId,
      error: error.response?.data
    });
    throw new Error('Failed to check MTN MoMo payment status');
  }
};

/**
 * Get account balance (useful for merchant disbursements)
 * @returns {Object} - { availableBalance, currency }
 */
const getAccountBalance = async () => {
  const token = await getAccessToken();

  try {
    const response = await axios.get(
      `${BASE_URL}/collection/v1_0/account/balance`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': TARGET_ENV,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
        }
      }
    );

    return response.data;
  } catch (error) {
    logger.error('MTN MoMo: Get balance failed', { error: error.response?.data });
    throw new Error('Failed to get MTN MoMo account balance');
  }
};

/**
 * Validate customer account (check if number is registered for MoMo)
 * @param {string} customerPhone
 * @returns {boolean}
 */
const validateAccount = async (customerPhone) => {
  const token = await getAccessToken();
  const formattedPhone = formatForMoMo(customerPhone);

  try {
    const response = await axios.get(
      `${BASE_URL}/collection/v1_0/accountholder/msisdn/${formattedPhone}/active`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': TARGET_ENV,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
        }
      }
    );

    return response.data.result === true;
  } catch (error) {
    logger.warn('MTN MoMo: Account validation failed', { phone: formattedPhone });
    return false;
  }
};

module.exports = {
  requestToPay,
  getPaymentStatus,
  getAccountBalance,
  validateAccount
};
