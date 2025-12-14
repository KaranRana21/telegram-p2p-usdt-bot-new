// scripts/showOrder.js
require('dotenv').config();
const connectDB = require('../src/db');

// Ensure every model file is required so mongoose registers schemas
const EscrowWallet = require('../src/models/EscrowWallet');
const Order = require('../src/models/Order');

(async () => {
  try {
    await connectDB();
    const id = process.argv[2];
    if (!id) return console.log('Usage: node scripts/showOrder.js <orderId>');
    const o = await Order.findById(id).populate('escrowWalletUsed').lean();
    if (!o) return console.log('Order not found');
    console.log(JSON.stringify(o, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
