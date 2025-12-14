// scripts/listEscrows.js
require('dotenv').config();
const connectDB = require('../src/db');
const EscrowWallet = require('../src/models/EscrowWallet');

(async () => {
  try {
    await connectDB();
    const wallets = await EscrowWallet.find().lean();
    console.log('Escrow wallets:', wallets);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
