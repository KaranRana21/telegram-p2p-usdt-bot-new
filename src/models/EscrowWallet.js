// src/models/EscrowWallet.js
const mongoose = require('mongoose');

const escrowSchema = new mongoose.Schema({
  network: { type: String, default: 'USDT' }, // currency label
  role: { type: String }, // FUNDING | ESCROW_MASTER | FEE
  ledgerAccountId: { type: String }, // Tatum ledger account id
  address: { type: String }, // optional human-facing address or label
  privateKey: { type: String, default: null }, // not used for VA, keep null in VA mode
  label: String,
}, { timestamps: true });

module.exports = mongoose.model('EscrowWallet', escrowSchema);