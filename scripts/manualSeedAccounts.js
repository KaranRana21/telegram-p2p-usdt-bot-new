// scripts/manualSeedAccounts.js
// Manual script to seed escrow accounts if you have the account IDs from another source
require('dotenv').config();
const connectDB = require('../src/db');
const EscrowWallet = require('../src/models/EscrowWallet');

(async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
    console.log('\n⚠️  This script allows you to manually enter Tatum Virtual Account IDs');
    console.log('   if you have them from another source (e.g., Tatum dashboard)\n');

    const currency = process.env.TATUM_VA_CURRENCY || 'USDT';
    
    // You can modify these values if you have the account IDs
    const ESCROW_ACCOUNT_ID = process.env.MANUAL_ESCROW_ACCOUNT_ID || '';
    const FEE_ACCOUNT_ID = process.env.MANUAL_FEE_ACCOUNT_ID || '';
    const FUNDING_ACCOUNT_ID = process.env.MANUAL_FUNDING_ACCOUNT_ID || '';

    if (!ESCROW_ACCOUNT_ID && !FEE_ACCOUNT_ID && !FUNDING_ACCOUNT_ID) {
      console.log('No manual account IDs found in environment variables.');
      console.log('You can set these in your .env file:');
      console.log('  MANUAL_ESCROW_ACCOUNT_ID=your_escrow_account_id');
      console.log('  MANUAL_FEE_ACCOUNT_ID=your_fee_account_id');
      console.log('  MANUAL_FUNDING_ACCOUNT_ID=your_funding_account_id');
      console.log('\nOr get them from your Tatum dashboard if you have Virtual Account access there.');
      process.exit(0);
    }

    const upsert = async (role, accountId) => {
      if (!accountId) {
        console.log(`⚠️  Skipping ${role} - no account ID provided`);
        return null;
      }

      const label = `VA_${role}_${currency}`;
      const existing = await EscrowWallet.findOne({ role, network: currency });
      
      if (existing) {
        existing.ledgerAccountId = accountId;
        existing.label = label;
        await existing.save();
        console.log(`✅ Updated ${role}: ${accountId}`);
        return existing;
      } else {
        const doc = await EscrowWallet.create({
          network: currency,
          role,
          ledgerAccountId: accountId,
          address: null,
          privateKey: null,
          label,
        });
        console.log(`✅ Created ${role}: ${accountId}`);
        return doc;
      }
    };

    const f1 = await upsert('FUNDING', FUNDING_ACCOUNT_ID);
    const f2 = await upsert('ESCROW_MASTER', ESCROW_ACCOUNT_ID);
    const f3 = await upsert('FEE', FEE_ACCOUNT_ID);

    console.log('\n📋 Seeded accounts:');
    console.log({ FUNDING: f1?.ledgerAccountId || 'Not set', ESCROW_MASTER: f2?.ledgerAccountId || 'Not set', FEE: f3?.ledgerAccountId || 'Not set' });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();

