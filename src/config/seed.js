require('dotenv').config();
const { sequelize } = require('../config/database');
const { User, Merchant, Transaction } = require('../models');
const logger = require('../config/logger');

const seed = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Seeding database...');

    // ─── Admin User ────────────────────────────────────────────────────────────
    const admin = await User.findOrCreate({
      where: { phone: '0244000000' },
      defaults: {
        fullName: 'TapPay Admin',
        phone: '0244000000',
        email: 'admin@tappaych.com',
        password: 'Admin@1234',
        role: 'admin',
        isVerified: true,
        kycStatus: 'approved',
        network: 'MTN'
      }
    });
    logger.info('✅ Admin user seeded');

    // ─── Test Merchant User ────────────────────────────────────────────────────
    const [merchantUser] = await User.findOrCreate({
      where: { phone: '0241234567' },
      defaults: {
        fullName: 'Kofi Mensah',
        phone: '0241234567',
        email: 'kofi@kofistore.com',
        password: 'Test@1234',
        role: 'merchant',
        isVerified: true,
        kycStatus: 'approved',
        network: 'MTN'
      }
    });

    const [merchant] = await Merchant.findOrCreate({
      where: { userId: merchantUser.id },
      defaults: {
        merchantCode: 'GH-KOFI-1234',
        businessName: 'Kofi General Store',
        businessType: 'retail',
        ownerPhone: '0241234567',
        momoNumber: '0241234567',
        network: 'MTN',
        address: 'Accra Mall, Ring Road, Accra',
        region: 'Greater Accra',
        isVerified: true,
        commissionRate: 1.50
      }
    });
    logger.info('✅ Merchant seeded:', merchant.merchantCode);

    // ─── Test Customer User ────────────────────────────────────────────────────
    const [customer] = await User.findOrCreate({
      where: { phone: '0201234567' },
      defaults: {
        fullName: 'Ama Owusu',
        phone: '0201234567',
        email: 'ama@email.com',
        password: 'Test@1234',
        role: 'customer',
        isVerified: true,
        kycStatus: 'approved',
        network: 'Telecel'
      }
    });
    logger.info('✅ Customer seeded');

    // ─── Sample Transactions ──────────────────────────────────────────────────
    const sampleTxns = [
      { amount: 25.00, status: 'successful', network: 'MTN', paymentGateway: 'mtn_momo' },
      { amount: 150.00, status: 'successful', network: 'Telecel', paymentGateway: 'ghipss' },
      { amount: 12.50, status: 'successful', network: 'MTN', paymentGateway: 'mtn_momo' },
      { amount: 75.00, status: 'failed', network: 'AirtelTigo', paymentGateway: 'ghipss' },
      { amount: 300.00, status: 'successful', network: 'MTN', paymentGateway: 'mtn_momo' }
    ];

    for (const [i, txn] of sampleTxns.entries()) {
      await Transaction.findOrCreate({
        where: { referenceId: `TPG-SEED-000${i + 1}` },
        defaults: {
          referenceId: `TPG-SEED-000${i + 1}`,
          customerId: customer.id,
          customerPhone: customer.phone,
          merchantId: merchant.id,
          merchantCode: merchant.merchantCode,
          amount: txn.amount,
          fee: txn.amount <= 50 ? 0.25 : txn.amount <= 100 ? 0.50 : 1.00,
          netAmount: txn.amount - (txn.amount <= 50 ? 0.25 : 0.50),
          currency: 'GHS',
          network: txn.network,
          status: txn.status,
          paymentMethod: 'nfc',
          paymentGateway: txn.paymentGateway,
          completedAt: txn.status === 'successful' ? new Date() : null
        }
      });
    }
    logger.info('✅ Sample transactions seeded');

    logger.info('\n🎉 Seed complete! Test credentials:');
    logger.info('   Admin:    0244000000 / Admin@1234');
    logger.info('   Merchant: 0241234567 / Test@1234');
    logger.info('   Customer: 0201234567 / Test@1234');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

seed();
