// src/tatumLedger.js
const LedgerAccount = require('./models/LedgerAccount');

const USE_MOCK = process.env.USE_MOCK_LEDGER === 'true';

/* ======================================================
   MOCK LEDGER IMPLEMENTATION (NO TRANSACTIONS)
====================================================== */

/**
 * Ensure a user ledger account exists
 */
async function mockEnsureUserLedgerAccount(telegramId, currency = 'USDT') {
  const accountId = `USER_${telegramId}`;

  let acc = await LedgerAccount.findOne({
    accountId,
    ledgerType: 'MOCK',
  });

  if (!acc) {
    acc = await LedgerAccount.create({
      accountId,
      role: 'USER',
      ledgerType: 'MOCK',
      currency,
      balance: 0,
      isSystem: false,
    });
  }

  return acc;
}

/**
 * Get balance of a ledger account
 */
async function mockGetAccountBalance(accountId) {
  const acc = await LedgerAccount.findOne({
    accountId,
    ledgerType: 'MOCK',
  });

  if (!acc) {
    throw new Error('Ledger account not found');
  }

  return {
    accountId: acc.accountId,
    currency: acc.currency,
    balance: acc.balance,
  };
}

/**
 * Transfer funds between two ledger accounts
 * NOTE: No Mongo transactions (standalone-safe)
 */
async function mockSendLedgerTransfer({ senderAccountId, recipientAccountId, amount }) {
  if (!amount || amount <= 0) {
    throw new Error('Invalid transfer amount');
  }

  const sender = await LedgerAccount.findOne({
    accountId: senderAccountId,
    ledgerType: 'MOCK',
  });

  const recipient = await LedgerAccount.findOne({
    accountId: recipientAccountId,
    ledgerType: 'MOCK',
  });

  if (!sender) {
    throw new Error(`Sender ledger account not found: ${senderAccountId}`);
  }

  if (!recipient) {
    throw new Error(`Recipient ledger account not found: ${recipientAccountId}`);
  }

  if (sender.balance < amount) {
    throw new Error('Insufficient balance');
  }

  sender.balance -= amount;
  recipient.balance += amount;

  await sender.save();
  await recipient.save();

  return {
    reference: `MOCK_TX_${Date.now()}`,
  };
}

/* ======================================================
   TATUM PLACEHOLDER (FUTURE)
====================================================== */

if (!USE_MOCK) {
  console.warn('⚠️ Tatum mode selected but not implemented yet');
}

/* ======================================================
   PUBLIC API
====================================================== */

module.exports = {
  async ensureUserLedgerAccount(telegramId, currency = 'USDT') {
    if (USE_MOCK) {
      return mockEnsureUserLedgerAccount(telegramId, currency);
    }
    throw new Error('Tatum mode not implemented yet');
  },

  async getAccountBalance(accountId) {
    if (USE_MOCK) {
      return mockGetAccountBalance(accountId);
    }
    throw new Error('Tatum mode not implemented yet');
  },

  async sendLedgerTransfer(payload) {
    if (USE_MOCK) {
      return mockSendLedgerTransfer(payload);
    }
    throw new Error('Tatum mode not implemented yet');
  },
};
