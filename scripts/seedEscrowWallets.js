// scripts/seedEscrowWallets.js
require('dotenv').config();
const connectDB = require('../src/db'); // your DB connection module
const EscrowWallet = require('../src/models/EscrowWallet');
const { createEthEscrowWallet } = require('../src/tatum');

async function seed() {
  await connectDB();

  // Check if already present
  const existingPrimary = await EscrowWallet.findOne({ network: 'ERC20', role: 'PRIMARY' });
  const existingFee = await EscrowWallet.findOne({ network: 'ERC20', role: 'FEE' });

  if (existingPrimary && existingFee) {
    console.log('Escrow wallets already seeded:');
    console.log({ primary: existingPrimary.address, fee: existingFee.address });
    process.exit(0);
  }

  console.log('Creating PRIMARY..');
  const w1 = await createEthEscrowWallet();
  await EscrowWallet.create({
    network: 'ERC20',
    role: 'PRIMARY',
    address: w1.address,
    privateKey: w1.privateKey,
    label: 'ERC20_PRIMARY'
  });

  console.log('Creating FEE..');
  const w2 = await createEthEscrowWallet();
  await EscrowWallet.create({
    network: 'ERC20',
    role: 'FEE',
    address: w2.address,
    privateKey: w2.privateKey,
    label: 'ERC20_FEE'
  });

  console.log('Seed complete. PRIMARY:', w1.address, 'FEE:', w2.address);
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
