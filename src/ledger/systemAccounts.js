const LedgerAccount = require('../models/LedgerAccount');

function getLedgerType() {
  return process.env.USE_MOCK_LEDGER === 'true' ? 'MOCK' : 'TATUM';
}

async function getSystemEscrow() {
  const acc = await LedgerAccount.findOne({
    role: 'SYSTEM_ESCROW',
    ledgerType: getLedgerType(),
  });

  if (!acc) {
    throw new Error(
      'System not initialized. Admin: run scripts/seedLedgerMasterAccounts.js'
    );
  }
  return acc;
}

async function getSystemFee() {
  const acc = await LedgerAccount.findOne({
    role: 'SYSTEM_FEE',
    ledgerType: getLedgerType(),
  });

  if (!acc) {
    throw new Error('System fee account missing.');
  }
  return acc;
}

module.exports = {
  getSystemEscrow,
  getSystemFee,
};
