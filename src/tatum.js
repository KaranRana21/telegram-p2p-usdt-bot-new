// src/tatum.js
require('dotenv').config();
const axios = require('axios');

const TATUM_API_KEY = process.env.TATUM_API_KEY;
const TATUM_NETWORK = process.env.TATUM_NETWORK || 'ethereum-sepolia';
const TATUM_BASE_URL = 'https://api.tatum.io';

if (!TATUM_API_KEY) console.warn('⚠️ TATUM_API_KEY is not set.');

function baseHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': TATUM_API_KEY,
    'x-testnet-type': TATUM_NETWORK,
  };
}

async function requestWithRetry(config, attempts = 3, initialDelayMs = 600) {
  let attempt = 0, delay = initialDelayMs;
  while (attempt < attempts) {
    try {
      const res = await axios({ timeout: 30000, ...config, headers: { ...(config.headers || {}), ...baseHeaders() } });
      return res;
    } catch (err) {
      attempt++;
      const status = err.response?.status;
      console.error(`Tatum request failed attempt ${attempt}`, { url: config.url, method: config.method, status, body: err.response?.data || err.message });
      if ((status === 429 || (status >= 500 && status < 600)) && attempt < attempts) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exceeded retries');
}

// --- create wallet (same code you've been using) ---
async function createEthEscrowWallet() {
  try {
    const walletRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/ethereum/wallet`, method: 'get' });
    const { xpub, mnemonic } = walletRes.data;
    const addrRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/ethereum/address/${encodeURIComponent(xpub)}/0`, method: 'get', params: { testnetType: TATUM_NETWORK } });
    const address = addrRes.data?.address;
    const privRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/ethereum/wallet/priv`, method: 'post', data: { mnemonic, index: 0 } });
    const privateKey = privRes.data?.key;
    return { address, privateKey, blockchain: TATUM_NETWORK, xpub, mnemonic };
  } catch (err) {
    console.error('createEthEscrowWallet error:', err.response?.data || err.message || err);
    throw err;
  }
}

// --- single ERC20 transfer helper (kept for reference) ---
async function sendUsdtFromEscrow({ escrowAddress, escrowPrivateKey, toAddress, amount }) {
  const contractAddress = process.env.USDT_CONTRACT;
  const usdtDecimals = Number(process.env.USDT_DECIMALS || '6');
  if (!contractAddress) throw new Error('USDT_CONTRACT not set');

  const amountStr = String(amount);

  // estimate
  const estimateRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/blockchain/estimate`, method: 'post', data: { chain: 'ETH', type: 'TRANSFER_ERC20', sender: escrowAddress, recipient: toAddress, contractAddress, amount: amountStr } });
  const gasLimit = String(estimateRes.data.gasLimit || 210000);
  const gasPrice = String(Math.ceil(Number(estimateRes.data.gasPrice || 1e9)));

  const nonceRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/ethereum/transaction/count/${escrowAddress}`, method: 'get', params: { testnetType: TATUM_NETWORK } });
  const nonce = Number(nonceRes.data);

  const txRes = await requestWithRetry({
    url: `${TATUM_BASE_URL}/v3/blockchain/token/transaction`,
    method: 'post',
    params: { testnetType: TATUM_NETWORK },
    data: {
      chain: 'ETH',
      contractAddress,
      digits: usdtDecimals,
      amount: amountStr,
      to: toAddress,
      nonce,
      fee: { gasLimit, gasPrice },
      fromPrivateKey: escrowPrivateKey,
    },
  });

  return { txId: txRes.data.txId || txRes.data.txHash || txRes.data.txid, raw: txRes.data };
}

// --- NEW: split-send from PRIMARY (fee + remainder) ---
async function sendSplitUsdtFromPrimary({ primaryAddress, primaryPrivateKey, feeAddress, toAddress, amount, feePercent = 5 }) {
  const contractAddress = process.env.USDT_CONTRACT;
  const usdtDecimals = Number(process.env.USDT_DECIMALS || '6');
  if (!contractAddress) throw new Error('USDT_CONTRACT not set');

  // compute amounts (keep decimals)
  const feeAmount = Number(( (Number(amount) * feePercent) / 100 ).toFixed(usdtDecimals));
  const remainder = Number((Number(amount) - feeAmount).toFixed(usdtDecimals));
  if (remainder <= 0) throw new Error('Remainder is non-positive for this feePercent');

  // estimate gas (best-effort)
  const estimateRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/blockchain/estimate`, method: 'post', data: { chain: 'ETH', type: 'TRANSFER_ERC20', sender: primaryAddress, recipient: toAddress, contractAddress, amount: String(amount) } });
  const gasLimit = String(estimateRes.data.gasLimit || 210000);
  const gasPrice = String(Math.ceil(Number(estimateRes.data.gasPrice || 1e9)));

  // nonce
  const nonceRes = await requestWithRetry({ url: `${TATUM_BASE_URL}/v3/ethereum/transaction/count/${primaryAddress}`, method: 'get', params: { testnetType: TATUM_NETWORK } });
  let nonce = Number(nonceRes.data);

  // first: fee tx
  const feeTxRes = await requestWithRetry({
    url: `${TATUM_BASE_URL}/v3/blockchain/token/transaction`,
    method: 'post',
    params: { testnetType: TATUM_NETWORK },
    data: {
      chain: 'ETH',
      contractAddress,
      digits: usdtDecimals,
      amount: String(feeAmount),
      to: feeAddress,
      nonce,
      fee: { gasLimit, gasPrice },
      fromPrivateKey: primaryPrivateKey,
    },
  });
  const feeTxId = feeTxRes.data.txId || feeTxRes.data.txHash || feeTxRes.data.txid;
  nonce++;

  // second: remainder to buyer
  const releaseTxRes = await requestWithRetry({
    url: `${TATUM_BASE_URL}/v3/blockchain/token/transaction`,
    method: 'post',
    params: { testnetType: TATUM_NETWORK },
    data: {
      chain: 'ETH',
      contractAddress,
      digits: usdtDecimals,
      amount: String(remainder),
      to: toAddress,
      nonce,
      fee: { gasLimit, gasPrice },
      fromPrivateKey: primaryPrivateKey,
    },
  });
  const releaseTxId = releaseTxRes.data.txId || releaseTxRes.data.txHash || releaseTxRes.data.txid;

  return {
    feeAmount,
    feeTxId,
    releaseTxId,
    raw: { feeRes: feeTxRes.data, releaseRes: releaseTxRes.data }
  };
}

module.exports = {
  createEthEscrowWallet,
  sendUsdtFromEscrow,
  sendSplitUsdtFromPrimary,
};
