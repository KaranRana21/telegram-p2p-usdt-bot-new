// scripts/checkBalances.js
require('dotenv').config();
const Web3 = require('web3');

const providerUrl = process.env.TATUM_RPC_URL || 'https://rpc.sepolia.org'; // fallback
const web3 = new Web3(providerUrl);

const ERC20_ABI = [
  // balanceOf
  { constant: true, inputs: [{ name: "_owner", type: "address" }], name: "balanceOf", outputs: [{ name: "balance", type: "uint256" }], type: "function" },
  { constant: true, inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], type: "function" }
];

(async () => {
  const primary = '0x05399bc00b4908b5d34ca2fab3f29118c69164db';
  const usdtContract = process.env.USDT_CONTRACT;
  try {
    const ethBal = await web3.eth.getBalance(primary);
    console.log('ETH (wei):', ethBal, 'ETH:', web3.utils.fromWei(ethBal, 'ether'));

    if (usdtContract) {
      const token = new web3.eth.Contract(ERC20_ABI, usdtContract);
      const decimals = await token.methods.decimals().call();
      const bal = await token.methods.balanceOf(primary).call();
      const human = Number(bal) / (10 ** decimals);
      console.log(`USDT balance: raw=${bal} decimals=${decimals} human=${human}`);
    } else {
      console.log('USDT_CONTRACT not set in .env — cannot check token balance.');
    }
  } catch (err) {
    console.error('Error checking balances:', err.message || err);
  } finally {
    process.exit(0);
  }
})();
