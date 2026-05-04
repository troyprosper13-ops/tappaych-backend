require('dotenv').config();
const { sequelize } = require('../config/database');
const { User, Merchant, Transaction, NfcSession, AuditLog } = require('../models');
const logger = require('../config/logger');

const migrate = async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Database connected');

    // Force sync creates tables fresh (use alter:true in production)
    const force = process.argv.includes('--fresh');

    await sequelize.sync({ force, alter: !force });
    logger.info(`✅ Tables synced (${force ? 'FRESH' : 'ALTER'})`);

    // Create indexes for performance
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_reference_id ON transactions(reference_id);
      CREATE INDEX IF NOT EXISTS idx_nfc_sessions_token ON nfc_sessions(session_token);
      CREATE INDEX IF NOT EXISTS idx_nfc_sessions_merchant ON nfc_sessions(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_merchants_code ON merchants(merchant_code);
    `);

    logger.info('✅ Indexes created');
    logger.info('🎉 Migration complete');
    process.exit(0);

  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrate();
