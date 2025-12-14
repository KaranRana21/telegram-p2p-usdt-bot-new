// src/receipt.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const moment = require('moment');

async function generateReceipt(order, extra = {}) {
  const outDir = path.join(__dirname, '../receipts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const html = `
  <html>
  <head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .header { text-align:center; margin-bottom: 20px;}
    .section { margin-bottom: 12px; }
    table { width:100%; border-collapse: collapse; }
    td, th { padding: 8px; border: 1px solid #ddd; }
  </style></head>
  <body>
    <div class="header"><h2>P2P Exchange Receipt</h2></div>
    <div class="section">
      <b>Order ID:</b> ${order._id} <br/>
      <b>Date:</b> ${moment(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}
    </div>
    <table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Type</td><td>${order.type}</td></tr>
      <tr><td>Network</td><td>${order.network}</td></tr>
      <tr><td>Amount (USDT)</td><td>${order.amountUSDT}</td></tr>
      <tr><td>Fee (USDT)</td><td>${order.feeAmount || 'N/A'}</td></tr>
      <tr><td>Escrow Address</td><td>${order.escrowAddress || 'N/A'}</td></tr>
      <tr><td>Buyer Address</td><td>${order.buyerAddress || 'N/A'}</td></tr>
      <tr><td>Fee Tx</td><td>${extra.feeTxId || order.feeTxId || 'N/A'}</td></tr>
      <tr><td>Release Tx</td><td>${extra.releaseTxId || order.releaseTxId || 'N/A'}</td></tr>
    </table>
    <div style="margin-top:16px">Thank you for using the P2P bot.</div>
  </body>
  </html>
  `;

  const filename = `${order._id}.pdf`;
  const outPath = path.join(outDir, filename);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: outPath, format: 'A4' });
  await browser.close();

  return outPath;
}

module.exports = { generateReceipt };
