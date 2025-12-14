// src/tatumLedger.js
const axios = require('axios');

const TATUM_BASE = process.env.TATUM_BASE_URL || 'https://api.tatum.io';
const API_KEY = process.env.TATUM_API_KEY;

if (!API_KEY) {
  console.error('TATUM_API_KEY must be set in .env');
  process.exit(1);
}

const api = axios.create({
  baseURL: `${TATUM_BASE}`,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 20000,
});

async function createLedgerAccount({ currency = 'USDT', externalId, customer = null, accountCode = null, accountingCurrency = 'USD' } = {}) {
  try {
    const body = { currency, externalId, accountingCurrency };
    if (customer) body.customer = customer;
    if (accountCode) body.accountCode = accountCode;
    const res = await api.post('/v3/ledger/account', body);
    return res.data;
  } catch (err) {
    throw new Error(`Tatum createLedgerAccount error: ${err.response?.data?.message || err.message}`);
  }
}

async function getAccountsByExternalId(externalId) {
  try {
    const res = await api.get(`/v3/ledger/account?externalId=${encodeURIComponent(externalId)}`);
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 404) return [];
    throw new Error(`Tatum getAccountsByExternalId error: ${err.response?.data?.message || err.message}`);
  }
}

async function getAccountById(accountId) {
  try {
    const res = await api.get(`/v3/ledger/account/${accountId}`);
    return res.data;
  } catch (err) {
    throw new Error(`Tatum getAccountById error: ${err.response?.data?.message || err.message}`);
  }
}

async function getAccountBalance(accountId) {
  try {
    // Try to get account with balance information
    const account = await getAccountById(accountId);
    
    // Extract balance from account data
    // Tatum account object may have balance, balances, or activeBalance fields
    let balance = null;
    let currency = null;
    
    if (account.balance !== undefined) {
      balance = account.balance;
      currency = account.currency || 'USDT';
    } else if (account.balances && account.balances.length > 0) {
      // If balances is an array, get the first one
      balance = account.balances[0].balance || account.balances[0].availableBalance;
      currency = account.balances[0].currency || account.currency || 'USDT';
    } else if (account.activeBalance !== undefined) {
      balance = account.activeBalance;
      currency = account.currency || 'USDT';
    } else if (account.availableBalance !== undefined) {
      balance = account.availableBalance;
      currency = account.currency || 'USDT';
    }
    
    return {
      accountId: account.id || account.accountId || account.account,
      currency: currency || account.currency || 'USDT',
      balance: balance !== null ? String(balance) : '0',
      account: account, // Include full account data for reference
    };
  } catch (err) {
    // If getAccountById fails, try alternative balance endpoint
    try {
      const res = await api.get(`/v3/ledger/account/${accountId}/balance`);
      return {
        accountId,
        currency: res.data.currency || 'USDT',
        balance: String(res.data.balance || res.data.availableBalance || '0'),
        account: res.data,
      };
    } catch (balanceErr) {
      // If both methods fail, throw the original error with context
      const errorMsg = err.response?.data?.message || err.message || balanceErr.message;
      throw new Error(`Tatum getAccountBalance error: ${errorMsg}`);
    }
  }
}

async function sendLedgerTransfer({ senderAccountId, recipientAccountId, amount, paymentId = undefined, senderNote = undefined, recipientNote = undefined } = {}) {
  try {
    const body = { senderAccountId, recipientAccountId, amount: String(amount) };
    if (paymentId) body.paymentId = String(paymentId);
    if (senderNote) body.senderNote = senderNote;
    if (recipientNote) body.recipientNote = recipientNote;
    const res = await api.post('/v3/ledger/transaction', body);
    return res.data;
  } catch (err) {
    throw new Error(`Tatum sendLedgerTransfer error: ${err.response?.data?.message || err.message}`);
  }
}

async function ensureUserLedgerAccount(telegramId, currency = 'USDT') {
  const externalId = `tg_${telegramId}_${currency}`;
  const existing = await getAccountsByExternalId(externalId);
  if (existing && existing.length) return existing[0];
  const acc = await createLedgerAccount({ currency, externalId });
  return acc;
}

async function ensureSystemAccounts(currency = 'USDT') {
  const fundingExt = `system_funding_${currency}`;
  const escrowExt = `system_escrow_${currency}`;
  const feeExt = `system_fee_${currency}`;

  const results = {};

  // Try to create accounts directly - Tatum may handle duplicates gracefully
  // or return the existing account if externalId matches
  try {
    results.fundingAccount = await createLedgerAccount({ currency, externalId: fundingExt });
    console.log('Created/retrieved funding account:', results.fundingAccount.id || results.fundingAccount.accountId);
  } catch (err) {
    // If account already exists with same externalId, Tatum might return it or error
    // Try to get it by externalId as fallback
    try {
      const existing = await getAccountsByExternalId(fundingExt);
      if (existing && existing.length > 0) {
        results.fundingAccount = existing[0];
        console.log('Found existing funding account:', results.fundingAccount.id || results.fundingAccount.accountId);
      } else {
        throw new Error(`Failed to create or find funding account: ${err.message}`);
      }
    } catch (getErr) {
      // If both fail, the account might exist but we can't query it
      // In this case, we'll throw the original creation error
      throw new Error(`Failed to ensure funding account: ${err.message}`);
    }
  }

  try {
    results.escrowAccount = await createLedgerAccount({ currency, externalId: escrowExt });
    console.log('Created/retrieved escrow account:', results.escrowAccount.id || results.escrowAccount.accountId);
  } catch (err) {
    try {
      const existing = await getAccountsByExternalId(escrowExt);
      if (existing && existing.length > 0) {
        results.escrowAccount = existing[0];
        console.log('Found existing escrow account:', results.escrowAccount.id || results.escrowAccount.accountId);
      } else {
        throw new Error(`Failed to create or find escrow account: ${err.message}`);
      }
    } catch (getErr) {
      throw new Error(`Failed to ensure escrow account: ${err.message}`);
    }
  }

  try {
    results.feeAccount = await createLedgerAccount({ currency, externalId: feeExt });
    console.log('Created/retrieved fee account:', results.feeAccount.id || results.feeAccount.accountId);
  } catch (err) {
    try {
      const existing = await getAccountsByExternalId(feeExt);
      if (existing && existing.length > 0) {
        results.feeAccount = existing[0];
        console.log('Found existing fee account:', results.feeAccount.id || results.feeAccount.accountId);
      } else {
        throw new Error(`Failed to create or find fee account: ${err.message}`);
      }
    } catch (getErr) {
      throw new Error(`Failed to ensure fee account: ${err.message}`);
    }
  }

  return results;
}

module.exports = {
  createLedgerAccount,
  getAccountsByExternalId,
  getAccountById,
  getAccountBalance,
  sendLedgerTransfer,
  ensureUserLedgerAccount,
  ensureSystemAccounts,
};
