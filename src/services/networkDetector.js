/**
 * Network Detector Service
 * Detects Ghana mobile money network from phone number prefix
 */

const NETWORK_PREFIXES = {
  MTN: ['024', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '056', '027', '057']
};

/**
 * Normalize a Ghana phone number to local format (0XX...)
 * Handles: 0241234567, +233241234567, 233241234567
 */
const normalizePhone = (phone) => {
  if (!phone) return null;
  let normalized = phone.replace(/\s+/g, '').replace(/-/g, '');

  if (normalized.startsWith('+233')) {
    normalized = '0' + normalized.slice(4);
  } else if (normalized.startsWith('233')) {
    normalized = '0' + normalized.slice(3);
  }

  if (!normalized.startsWith('0')) {
    normalized = '0' + normalized;
  }

  return normalized;
};

/**
 * Detect network from Ghana phone number
 * @param {string} phone - Phone number in any format
 * @returns {string} - 'MTN' | 'Telecel' | 'AirtelTigo' | 'unknown'
 */
const detectNetwork = (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 3) return 'unknown';

  const prefix = normalized.substring(0, 3);

  for (const [network, prefixes] of Object.entries(NETWORK_PREFIXES)) {
    if (prefixes.includes(prefix)) return network;
  }

  return 'unknown';
};

/**
 * Determine which payment gateway to use based on network
 * @param {string} network
 * @returns {string} - 'mtn_momo' | 'ghipss'
 */
const getPaymentGateway = (network) => {
  return network === 'MTN' ? 'mtn_momo' : 'ghipss';
};

/**
 * Format phone for MTN MoMo API (international format without +)
 * @param {string} phone
 * @returns {string} - e.g. '233241234567'
 */
const formatForMoMo = (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return '233' + normalized.slice(1);
};

/**
 * Validate if phone number is a valid Ghana number
 * @param {string} phone
 * @returns {boolean}
 */
const isValidGhanaPhone = (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return /^0[0-9]{9}$/.test(normalized) && detectNetwork(normalized) !== 'unknown';
};

module.exports = {
  detectNetwork,
  getPaymentGateway,
  formatForMoMo,
  normalizePhone,
  isValidGhanaPhone,
  NETWORK_PREFIXES
};
