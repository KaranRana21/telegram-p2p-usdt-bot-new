// Quick test script to verify bot setup
require('dotenv').config();

console.log('🔍 Testing Bot Configuration...\n');

// Check environment variables
const checks = {
  'BOT_TOKEN': process.env.BOT_TOKEN,
  'MONGO_URI': process.env.MONGO_URI,
  'TATUM_API_KEY': process.env.TATUM_API_KEY,
  'TATUM_VA_CURRENCY': process.env.TATUM_VA_CURRENCY || 'USDT',
  'USDT_CONTRACT': process.env.USDT_CONTRACT,
};

console.log('📋 Environment Variables:');
let allGood = true;
for (const [key, value] of Object.entries(checks)) {
  if (value) {
    if (key.includes('TOKEN') || key.includes('KEY')) {
      console.log(`  ✅ ${key}: ${value.substring(0, 20)}...`);
    } else {
      console.log(`  ✅ ${key}: ${value}`);
    }
  } else {
    console.log(`  ❌ ${key}: NOT SET`);
    allGood = false;
  }
}

// Test MongoDB connection
console.log('\n🔌 Testing MongoDB Connection...');
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('  ✅ MongoDB connected successfully');
    return mongoose.connection.close();
  })
  .catch(err => {
    console.log('  ❌ MongoDB connection failed:', err.message);
    allGood = false;
  })
  .finally(() => {
    if (allGood) {
      console.log('\n✅ All checks passed! You can start the bot with: npm start');
    } else {
      console.log('\n❌ Some checks failed. Please fix the issues above.');
    }
    process.exit(allGood ? 0 : 1);
  });

