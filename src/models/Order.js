// src/models/Order.js
const mongoose = require('mongoose');

const ORDER_TYPES = ['BUY', 'SELL'];
const NETWORKS = ['ERC20', 'TRC20'];
const STATUSES = [
  'OPEN',
  'MATCHED',
  'PAID',
  'RELEASED',
  'CANCELLED',
  'DISPUTED',
];

const orderSchema = new mongoose.Schema(
  {
    creatorTelegramId: { type: String, required: true },
    takerTelegramId: { type: String },

    type: { type: String, enum: ORDER_TYPES, required: true },   // BUY / SELL
    network: { type: String, enum: NETWORKS, required: true },   // ERC20 / TRC20

    amountUSDT: { type: Number, required: true },
    fiatCurrency: { type: String, default: 'INR' },
    fiatMethod: { type: String, default: 'UPI' },

    status: { type: String, enum: STATUSES, default: 'OPEN' },

    // Virtual ledger references (Tatum VA)
    escrowLedgerAccountId: { type: String }, // ledger account id of ESCROW_MASTER used for this order
    buyerLedgerAccountId: { type: String },  // buyer's VA account id
    sellerLedgerAccountId: { type: String }, // seller's VA account id (creator's VA)

    // Transaction references
    escrowDepositTxRef: { type: String },   // when user deposits into escrow
    releaseTxRef: { type: String },         // reference id for escrow->buyer
    feeTxRef: { type: String },             // reference id for escrow->fee

    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUSES = STATUSES;
