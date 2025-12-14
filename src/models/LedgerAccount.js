// src/models/LedgerAccount.js
const mongoose = require('mongoose');

const LedgerAccountSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      required: true,
      index: true,
    },
    ledgerType: {
      type: String,
      enum: ['MOCK', 'TATUM'],
      required: true,
      index: true,
    },
    currency: {
      type: String,
      default: 'USDT',
    },
    balance: {
      type: Number,
      default: 0,
    },
    isSystem: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LedgerAccount', LedgerAccountSchema);
