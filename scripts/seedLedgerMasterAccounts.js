// scripts/seedLedgerMasterAccounts.js
require('dotenv').config();
const connectDB = require('../src/db');
const EscrowWallet = require('../src/models/EscrowWallet');
const tatum = require('../src/tatumLedger');

(async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    const currency = process.env.TATUM_VA_CURRENCY || 'USDT';
    const { fundingAccount, escrowAccount, feeAccount } = await tatum.ensureSystemAccounts(currency);

    const upsert = async (role, acc) => {
      const label = `VA_${role}_${currency}`;
      const existing = await EscrowWallet.findOne({ role, network: currency });
      const ledgerAccountId = acc.id || acc.accountId || acc.account;
      const address = acc.address || (acc.addresses && acc.addresses[0]) || null;
      if (existing) {
        existing.ledgerAccountId = ledgerAccountId;
        existing.address = address || existing.address;
        existing.label = label;
        await existing.save();
        return existing;
      } else {
        const doc = await EscrowWallet.create({
          network: currency,
          role,
          ledgerAccountId,
          address,
          privateKey: null,
          label,
        });
        return doc;
      }
    };

    const f1 = await upsert('FUNDING', fundingAccount);
    const f2 = await upsert('ESCROW_MASTER', escrowAccount);
    const f3 = await upsert('FEE', feeAccount);

    console.log('Seeded/updated system accounts:');
    console.log({ FUNDING: f1, ESCROW_MASTER: f2, FEE: f3 });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
