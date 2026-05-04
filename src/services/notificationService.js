const logger = require('../config/logger');

let firebaseAdmin = null;

/**
 * Initialize Firebase Admin SDK lazily
 */
const getFirebaseAdmin = () => {
  if (firebaseAdmin) return firebaseAdmin;

  try {
    const admin = require('firebase-admin');

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        })
      });
    }

    firebaseAdmin = admin;
    return admin;
  } catch (error) {
    logger.warn('Firebase Admin not initialized. Push notifications disabled.', {
      error: error.message
    });
    return null;
  }
};

/**
 * Send a push notification via Firebase Cloud Messaging
 * @param {string} fcmToken - Device FCM token
 * @param {string} title
 * @param {string} body
 * @param {Object} data - Extra data payload
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  const admin = getFirebaseAdmin();
  if (!admin) return false;

  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'payments' }
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 }
        }
      }
    };

    const response = await admin.messaging().send(message);
    logger.info('Push notification sent', { messageId: response });
    return true;

  } catch (error) {
    logger.error('Push notification failed', {
      error: error.message,
      code: error.code
    });
    return false;
  }
};

/**
 * Send payment-specific notifications
 */
const sendPaymentNotification = async ({ fcmToken, type, amount, merchantName, customerPhone }) => {
  const notifications = {
    payment_success: {
      title: '✅ Payment Successful',
      body: `GHS ${amount} paid to ${merchantName || 'merchant'} successfully`
    },
    payment_failed: {
      title: '❌ Payment Failed',
      body: `Your payment of GHS ${amount} could not be processed. Please try again.`
    },
    payment_received: {
      title: '💰 Payment Received',
      body: `GHS ${amount} received from ${customerPhone || 'customer'}`
    },
    payment_request: {
      title: '📱 Payment Request',
      body: `GHS ${amount} payment requested from ${merchantName || 'merchant'}`
    }
  };

  const notification = notifications[type];
  if (!notification) return false;

  return sendPushNotification(fcmToken, notification.title, notification.body, {
    type,
    amount: amount?.toString(),
    merchantName: merchantName || '',
    timestamp: new Date().toISOString()
  });
};

/**
 * Send to multiple tokens (e.g. merchant with multiple devices)
 */
const sendMulticast = async (fcmTokens, title, body, data = {}) => {
  const admin = getFirebaseAdmin();
  if (!admin || !fcmTokens?.length) return null;

  try {
    const message = {
      tokens: fcmTokens,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      )
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info('Multicast notification sent', {
      successCount: response.successCount,
      failureCount: response.failureCount
    });
    return response;

  } catch (error) {
    logger.error('Multicast notification failed', { error: error.message });
    return null;
  }
};

module.exports = {
  sendPushNotification,
  sendPaymentNotification,
  sendMulticast
};
