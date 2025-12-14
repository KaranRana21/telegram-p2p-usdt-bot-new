// src/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  ledgerAccountId: String, // Tatum VA ledger account id
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
