// scripts/creditUserForTest.js
require('dotenv').config();
const connectDB = require('../src/db');
const tatum = require('../src/tatumLedger');

(async () => {
  try {
    await connectDB();
    const tgId = process.argv[2];
    const amount = process.argv[3] || '50'; // default 50 USDT

    if (!tgId) {
      console.log('Usage: node scripts/creditUserForTest.js <telegramId> [amount]');
      process.exit(1);
    }

    const currency = process.env.TATUM_VA_CURRENCY || 'USDT';
    const { fundingAccount } = await tatum.ensureSystemAccounts(currency);

    const userAcc = await tatum.ensureUserLedgerAccount(tgId, currency);
    console.log('User ledger account:', userAcc);

    const send = await tatum.sendLedgerTransfer({
      senderAccountId: fundingAccount.id || fundingAccount.accountId || fundingAccount.account,
      recipientAccountId: userAcc.id || userAcc.accountId || userAcc.account,
      amount: amount,
      paymentId: `topup_tg_${tgId}`,
      senderNote: 'DEV topup',
      recipientNote: `Topup for testing ${amount} ${currency}`,
    });

    console.log('Topup result:', send);
    process.exit(0);
  } catch (err) {
    console.error('Error creditUserForTest:', err.message || err);
    process.exit(1);
  }
})();
