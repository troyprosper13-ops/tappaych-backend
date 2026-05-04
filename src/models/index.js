const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── USER MODEL ───────────────────────────────────────────────────────────────
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fullName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'full_name'
  },
  phone: {
    type: DataTypes.STRING(15),
    allowNull: false,
    unique: true,
    validate: { notEmpty: true }
  },
  email: {
    type: DataTypes.STRING(150),
    unique: true,
    validate: { isEmail: true }
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  network: {
    type: DataTypes.ENUM('MTN', 'Telecel', 'AirtelTigo', 'unknown'),
    defaultValue: 'unknown'
  },
  momoNumber: {
    type: DataTypes.STRING(15),
    field: 'momo_number'
  },
  fcmToken: {
    type: DataTypes.TEXT,
    field: 'fcm_token'
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_verified'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  kycStatus: {
    type: DataTypes.ENUM('pending', 'submitted', 'approved', 'rejected'),
    defaultValue: 'pending',
    field: 'kyc_status'
  },
  role: {
    type: DataTypes.ENUM('customer', 'merchant', 'admin'),
    defaultValue: 'customer'
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    field: 'last_login_at'
  },
  refreshToken: {
    type: DataTypes.TEXT,
    field: 'refresh_token'
  }
}, {
  tableName: 'users',
  underscored: true,
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        user.password = await bcrypt.hash(user.password, rounds);
      }
      // Auto-detect network from phone
      user.network = detectNetworkFromPhone(user.phone);
      if (!user.momoNumber) user.momoNumber = user.phone;
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        user.password = await bcrypt.hash(user.password, rounds);
      }
    }
  }
});

User.prototype.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toSafeJSON = function() {
  const values = { ...this.get() };
  delete values.password;
  delete values.refreshToken;
  delete values.fcmToken;
  return values;
};

// ─── MERCHANT MODEL ───────────────────────────────────────────────────────────
const Merchant = sequelize.define('Merchant', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
    references: { model: 'users', key: 'id' }
  },
  merchantCode: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: false,
    field: 'merchant_code'
  },
  businessName: {
    type: DataTypes.STRING(150),
    allowNull: false,
    field: 'business_name'
  },
  businessType: {
    type: DataTypes.ENUM(
      'retail', 'food_beverage', 'transport',
      'services', 'healthcare', 'education', 'other'
    ),
    defaultValue: 'retail',
    field: 'business_type'
  },
  ownerPhone: {
    type: DataTypes.STRING(15),
    allowNull: false,
    field: 'owner_phone'
  },
  momoNumber: {
    type: DataTypes.STRING(15),
    allowNull: false,
    field: 'momo_number'
  },
  network: {
    type: DataTypes.ENUM('MTN', 'Telecel', 'AirtelTigo', 'unknown'),
    defaultValue: 'MTN'
  },
  address: {
    type: DataTypes.TEXT
  },
  region: {
    type: DataTypes.STRING(50)
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_verified'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  commissionRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 1.50,
    field: 'commission_rate'
  },
  totalTransactions: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_transactions'
  },
  totalVolume: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0.00,
    field: 'total_volume'
  },
  nfcPublicKey: {
    type: DataTypes.TEXT,
    field: 'nfc_public_key'
  }
}, {
  tableName: 'merchants',
  underscored: true
});

// ─── TRANSACTION MODEL ────────────────────────────────────────────────────────
const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referenceId: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: false,
    field: 'reference_id'
  },
  externalReference: {
    type: DataTypes.STRING(100),
    field: 'external_reference'
  },
  customerId: {
    type: DataTypes.UUID,
    field: 'customer_id',
    references: { model: 'users', key: 'id' }
  },
  customerPhone: {
    type: DataTypes.STRING(15),
    allowNull: false,
    field: 'customer_phone'
  },
  merchantId: {
    type: DataTypes.UUID,
    field: 'merchant_id',
    references: { model: 'merchants', key: 'id' }
  },
  merchantCode: {
    type: DataTypes.STRING(20),
    field: 'merchant_code'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    validate: { min: 0.01 }
  },
  fee: {
    type: DataTypes.DECIMAL(8, 2),
    defaultValue: 0.00
  },
  netAmount: {
    type: DataTypes.DECIMAL(12, 2),
    field: 'net_amount'
  },
  currency: {
    type: DataTypes.STRING(5),
    defaultValue: 'GHS'
  },
  network: {
    type: DataTypes.ENUM('MTN', 'Telecel', 'AirtelTigo', 'unknown'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded'),
    defaultValue: 'pending'
  },
  paymentMethod: {
    type: DataTypes.ENUM('nfc', 'qr_code', 'ussd', 'api'),
    defaultValue: 'nfc',
    field: 'payment_method'
  },
  paymentGateway: {
    type: DataTypes.ENUM('mtn_momo', 'ghipss'),
    field: 'payment_gateway'
  },
  failureReason: {
    type: DataTypes.TEXT,
    field: 'failure_reason'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  nfcSessionId: {
    type: DataTypes.STRING(100),
    field: 'nfc_session_id'
  },
  completedAt: {
    type: DataTypes.DATE,
    field: 'completed_at'
  },
  refundedAt: {
    type: DataTypes.DATE,
    field: 'refunded_at'
  }
}, {
  tableName: 'transactions',
  underscored: true
});

// ─── NFC SESSION MODEL ────────────────────────────────────────────────────────
const NfcSession = sequelize.define('NfcSession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessionToken: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
    field: 'session_token'
  },
  merchantId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'merchant_id'
  },
  merchantCode: {
    type: DataTypes.STRING(20),
    field: 'merchant_code'
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING(5),
    defaultValue: 'GHS'
  },
  status: {
    type: DataTypes.ENUM('active', 'tapped', 'completed', 'expired', 'cancelled'),
    defaultValue: 'active'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at'
  },
  tappedAt: {
    type: DataTypes.DATE,
    field: 'tapped_at'
  },
  transactionId: {
    type: DataTypes.UUID,
    field: 'transaction_id'
  }
}, {
  tableName: 'nfc_sessions',
  underscored: true
});

// ─── AUDIT LOG MODEL ──────────────────────────────────────────────────────────
const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    field: 'user_id'
  },
  action: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  resource: {
    type: DataTypes.STRING(100)
  },
  resourceId: {
    type: DataTypes.STRING(100),
    field: 'resource_id'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    field: 'ip_address'
  },
  userAgent: {
    type: DataTypes.TEXT,
    field: 'user_agent'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('success', 'failure'),
    defaultValue: 'success'
  }
}, {
  tableName: 'audit_logs',
  underscored: true,
  updatedAt: false
});

// ─── ASSOCIATIONS ─────────────────────────────────────────────────────────────
User.hasOne(Merchant, { foreignKey: 'userId', as: 'merchantProfile' });
Merchant.belongsTo(User, { foreignKey: 'userId', as: 'owner' });

User.hasMany(Transaction, { foreignKey: 'customerId', as: 'transactions' });
Transaction.belongsTo(User, { foreignKey: 'customerId', as: 'customer' });

Merchant.hasMany(Transaction, { foreignKey: 'merchantId', as: 'transactions' });
Transaction.belongsTo(Merchant, { foreignKey: 'merchantId', as: 'merchant' });

Merchant.hasMany(NfcSession, { foreignKey: 'merchantId', as: 'nfcSessions' });

// ─── HELPER FUNCTION ──────────────────────────────────────────────────────────
function detectNetworkFromPhone(phone) {
  if (!phone) return 'unknown';
  const normalized = phone.replace(/^\+233/, '0').replace(/^233/, '0');
  const prefix = normalized.substring(0, 3);
  const networkMap = {
    '024': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
    '020': 'Telecel', '050': 'Telecel',
    '026': 'AirtelTigo', '056': 'AirtelTigo',
    '027': 'AirtelTigo', '057': 'AirtelTigo'
  };
  return networkMap[prefix] || 'unknown';
}

module.exports = { User, Merchant, Transaction, NfcSession, AuditLog };
