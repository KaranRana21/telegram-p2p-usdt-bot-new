// scripts/seedLedgerMasterAccounts.js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/db');
const LedgerAccount = require('../src/models/LedgerAccount');

async function seed() {
  await connectDB();
  console.log('Connected to MongoDB');

  const ledgerType =
    process.env.USE_MOCK_LEDGER === 'true' ? 'MOCK' : 'TATUM';

  const systemAccounts = [
    {
      accountId: 'SYSTEM_ESCROW',
      role: 'SYSTEM_ESCROW',
    },
    {
      accountId: 'SYSTEM_FEE',
      role: 'SYSTEM_FEE',
    },
  ];

  for (const acc of systemAccounts) {
    const exists = await LedgerAccount.findOne({
      role: acc.role,
      ledgerType,
    });

    if (exists) {
      console.log(`ℹ️ ${acc.role} already exists`);
      continue;
    }

    await LedgerAccount.create({
      accountId: acc.accountId,
      role: acc.role,
      ledgerType,
      currency: 'USDT',
      balance: 0,
      isSystem: true,
    });

    console.log(`✅ Created ${acc.role}`);
  }

  console.log('✅ System ledger accounts ready');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
