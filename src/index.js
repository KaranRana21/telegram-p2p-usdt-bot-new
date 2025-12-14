// src/index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const connectDB = require('./db');

const User = require('./models/User');
const Order = require('./models/Order');

const ledger = require('./tatumLedger');
const { getSystemEscrow, getSystemFee } = require('./ledger/systemAccounts');

/* ======================================================
   BOT INIT
====================================================== */

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN missing');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

/* ======================================================
   SIMPLE IN-MEMORY SESSION (DEV)
====================================================== */

const sessions = new Map();

function getSession(ctx) {
  if (!sessions.has(ctx.chat.id)) {
    sessions.set(ctx.chat.id, { step: null, draft: null });
  }
  return sessions.get(ctx.chat.id);
}

function clearSession(ctx) {
  sessions.delete(ctx.chat.id);
}

/* ======================================================
   USER MIDDLEWARE
====================================================== */

bot.use(async (ctx, next) => {
  if (!ctx.from) return next();

  const telegramId = String(ctx.from.id);

  let user = await User.findOne({ telegramId });
  if (!user) {
    user = await User.create({
      telegramId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  }

  const acc = await ledger.ensureUserLedgerAccount(telegramId);
  if (user.ledgerAccountId !== acc.accountId) {
    user.ledgerAccountId = acc.accountId;
    await user.save();
  }

  ctx.dbUser = user;
  return next();
});

/* ======================================================
   HELPERS
====================================================== */

function getBuyerSeller(order) {
  if (order.type === 'SELL') {
    return {
      sellerTelegramId: order.creatorTelegramId,
      buyerTelegramId: order.takerTelegramId,
    };
  }
  return {
    buyerTelegramId: order.creatorTelegramId,
    sellerTelegramId: order.takerTelegramId,
  };
}

/* ======================================================
   START
====================================================== */

bot.start((ctx) => {
  ctx.reply(
    `Welcome to the *P2P USDT Bot*\n\n` +
      `/sell – create SELL order\n` +
      `/buy – create BUY order\n` +
      `/orders – open orders\n` +
      `/myorders – your orders\n` +
      `/take <orderId>\n` +
      `/markpaid <orderId>\n` +
      `/release <orderId>\n` +
      `/balance\n` +
      `/escrowbalance`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================================================
   CREATE ORDER (SELL / BUY)
====================================================== */

bot.command(['sell', 'buy'], (ctx) => {
  const s = getSession(ctx);
  s.step = 'NETWORK';
  s.draft = {
    type: ctx.message.text === '/sell' ? 'SELL' : 'BUY',
    creatorTelegramId: String(ctx.from.id),
  };
  ctx.reply('Reply with *ERC20* or *TRC20*', { parse_mode: 'Markdown' });
});

/* ======================================================
   ORDER CREATION FLOW (TEXT)
====================================================== */

bot.hears(/^(?!\/).+/, async (ctx) => {
  const s = getSession(ctx);
  if (!s || !s.step) return;

  const text = ctx.message.text.trim();

  try {
    if (s.step === 'NETWORK') {
      const net = text.toUpperCase();
      if (!['ERC20', 'TRC20'].includes(net)) {
        return ctx.reply('Invalid network. Use ERC20 or TRC20.');
      }
      s.draft.network = net;
      s.step = 'AMOUNT';
      return ctx.reply('USDT amount?');
    }

    if (s.step === 'AMOUNT') {
      const amt = Number(text);
      if (!amt || amt <= 0) return ctx.reply('Enter valid amount.');
      s.draft.amountUSDT = amt;
      s.step = 'FIAT';
      return ctx.reply('Fiat currency? (e.g. USD)');
    }

    if (s.step === 'FIAT') {
      s.draft.fiatCurrency = text.toUpperCase();
      s.step = 'METHOD';
      return ctx.reply('Fiat method? (e.g. BANK)');
    }

    if (s.step === 'METHOD') {
      s.draft.fiatMethod = text.toUpperCase();

      const escrow = await getSystemEscrow();

      const order = await Order.create({
        ...s.draft,
        status: 'OPEN',
        escrowLedgerAccountId: escrow.accountId,
        sellerLedgerAccountId: ctx.dbUser.ledgerAccountId,
      });

      clearSession(ctx);

      return ctx.reply(
        `✅ *Order Created*\n\nID: \`${order._id}\`\nEscrow: \`${escrow.accountId}\``,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('ORDER CREATE ERROR:', err);
    clearSession(ctx);
    ctx.reply('Failed to create order.');
  }
});

/* ======================================================
   LIST ORDERS
====================================================== */

bot.command('orders', async (ctx) => {
  const orders = await Order.find({ status: 'OPEN' }).sort({ createdAt: -1 });
  if (!orders.length) return ctx.reply('No open orders.');

  let msg = '*Open Orders*\n\n';
  orders.forEach((o) => {
    msg +=
      `ID: \`${o._id}\`\n` +
      `Type: *${o.type}*\n` +
      `Amount: *${o.amountUSDT} USDT*\n———\n`;
  });

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

/* ======================================================
   MY ORDERS
====================================================== */

bot.command('myorders', async (ctx) => {
  const orders = await Order.find({
    creatorTelegramId: String(ctx.from.id),
  }).sort({ createdAt: -1 });

  if (!orders.length) return ctx.reply('You have no orders.');

  let msg = '*Your Orders*\n\n';
  orders.forEach((o) => {
    msg +=
      `ID: \`${o._id}\`\n` +
      `Status: \`${o.status}\`\n———\n`;
  });

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

/* ======================================================
   TAKE ORDER
====================================================== */

// bot.command('take', async (ctx) => {
//   const orderId = ctx.message.text.split(' ')[1];
//   const order = await Order.findById(orderId);

//   if (!order || order.status !== 'OPEN') {
//     return ctx.reply('Order not available.');
//   }

//   order.takerTelegramId = String(ctx.from.id);
//   order.status = 'MATCHED';

//   // assign buyer/seller ledger ids
//   if (order.type === 'SELL') {
//     order.buyerLedgerAccountId = ctx.dbUser.ledgerAccountId;
//   } else {
//     order.sellerLedgerAccountId = ctx.dbUser.ledgerAccountId;
//   }

//   await order.save();
//   ctx.reply('Order matched. Buyer should send fiat.');
// });

bot.command('take', async (ctx) => {
  const orderId = ctx.message.text.split(' ')[1];
  if (!orderId) return ctx.reply('Usage: /take <orderId>');

  const order = await Order.findById(orderId);
  if (!order) return ctx.reply('Order not found.');

  if (order.creatorTelegramId === String(ctx.from.id)) {
    return ctx.reply('You cannot take your own order.');
  }

  if (order.status === 'MATCHED') {
    return ctx.reply('Order already matched.');
  }

  if (order.status === 'RELEASED') {
    return ctx.reply('Order already completed.');
  }

  if (order.status !== 'OPEN') {
    return ctx.reply(`Order not available (status: ${order.status}).`);
  }

  order.takerTelegramId = String(ctx.from.id);
  order.status = 'MATCHED';

  if (order.type === 'SELL') {
    order.buyerLedgerAccountId = ctx.dbUser.ledgerAccountId;
  } else {
    order.sellerLedgerAccountId = ctx.dbUser.ledgerAccountId;
  }

  await order.save();

  ctx.reply(
    '✅ Order matched.\n\n' +
    'Seller must deposit USDT into escrow.\n' +
    'After fiat transfer, buyer should run /markpaid.'
  );
});


/* ======================================================
   MARK PAID
====================================================== */

bot.command('markpaid', async (ctx) => {
  const orderId = ctx.message.text.split(' ')[1];
  const order = await Order.findById(orderId);

  if (!order || order.status !== 'MATCHED') {
    return ctx.reply('Invalid order state.');
  }

  const { buyerTelegramId } = getBuyerSeller(order);
  if (buyerTelegramId !== String(ctx.from.id)) {
    return ctx.reply('Only buyer can mark paid.');
  }

  order.status = 'PAID';
  await order.save();
  ctx.reply('Marked as PAID. Seller can now release.');
});

/* ======================================================
   RELEASE
====================================================== */

bot.command('release', async (ctx) => {
  const orderId = ctx.message.text.split(' ')[1];
  const order = await Order.findById(orderId);

  if (!order || order.status !== 'PAID') {
    return ctx.reply('Invalid order state.');
  }

  const { sellerTelegramId, buyerTelegramId } = getBuyerSeller(order);
  if (sellerTelegramId !== String(ctx.from.id)) {
    return ctx.reply('Only seller can release.');
  }

  const escrow = await getSystemEscrow();
  const fee = await getSystemFee();

  const feePct = Number(process.env.P2P_FEE_PERCENT || 5);
  const feeAmt = (order.amountUSDT * feePct) / 100;
  const sendAmt = order.amountUSDT - feeAmt;

  await ledger.sendLedgerTransfer({
    senderAccountId: escrow.accountId,
    recipientAccountId: `USER_${buyerTelegramId}`,
    amount: sendAmt,
  });

  await ledger.sendLedgerTransfer({
    senderAccountId: escrow.accountId,
    recipientAccountId: fee.accountId,
    amount: feeAmt,
  });

  order.status = 'RELEASED';
  await order.save();

  ctx.reply('✅ Order released successfully.');
});

/* ======================================================
   BALANCES
====================================================== */

bot.command('balance', async (ctx) => {
  const bal = await ledger.getAccountBalance(ctx.dbUser.ledgerAccountId);
  ctx.reply(`Balance: ${bal.balance} ${bal.currency}`);
});

bot.command('escrowbalance', async (ctx) => {
  const escrow = await getSystemEscrow();
  const bal = await ledger.getAccountBalance(escrow.accountId);
  ctx.reply(`Escrow Balance: ${bal.balance} ${bal.currency}`);
});


/* ======================================================
   Dev credit command
====================================================== */

// bot.command('devcredit', async (ctx) => {
//   const parts = ctx.message.text.split(' ');
//   const amount = Number(parts[1]);

//   if (!amount || amount <= 0) {
//     return ctx.reply('Usage: /devcredit <amount>');
//   }

//   const acc = await ledger.ensureUserLedgerAccount(String(ctx.from.id));

//   const LedgerAccount = require('./models/LedgerAccount');
//   const userAcc = await LedgerAccount.findOne({ accountId: acc.accountId });

//   userAcc.balance += amount;
//   await userAcc.save();

//   ctx.reply(`✅ Credited ${amount} USDT to your account.`);
// });

bot.command('devcredit', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const amount = Number(parts[1]);

  if (!amount || amount <= 0) {
    return ctx.reply('Usage: /devcredit <amount>');
  }

  const acc = await ledger.ensureUserLedgerAccount(String(ctx.from.id));

  const LedgerAccount = require('./models/LedgerAccount');
  const userAcc = await LedgerAccount.findOne({
    accountId: acc.accountId,
    ledgerType: 'MOCK',
  });

  if (!userAcc) {
    return ctx.reply('Ledger account not found for dev credit.');
  }

  userAcc.balance += amount;
  await userAcc.save();

  ctx.reply(`✅ Credited ${amount} USDT to your account.`);
});


/* ======================================================
   dev deposit
====================================================== */

// bot.command('devdeposit', async (ctx) => {
//   const orderId = ctx.message.text.split(' ')[1];
//   if (!orderId) return ctx.reply('Usage: /devdeposit <orderId>');

//   const order = await Order.findById(orderId);
//   if (!order) return ctx.reply('Order not found.');

//   const escrow = await getSystemEscrow();

//   await ledger.sendLedgerTransfer({
//     senderAccountId: ctx.dbUser.ledgerAccountId,
//     recipientAccountId: escrow.accountId,
//     amount: order.amountUSDT,
//   });

//   ctx.reply('✅ Deposited order amount into escrow.');
// });

bot.command('devdeposit', async (ctx) => {
  const orderId = ctx.message.text.split(' ')[1];
  if (!orderId) return ctx.reply('Usage: /devdeposit <orderId>');

  const order = await Order.findById(orderId);
  if (!order) return ctx.reply('Order not found.');

  const escrow = await getSystemEscrow();

  const bal = await ledger.getAccountBalance(ctx.dbUser.ledgerAccountId);

  if (bal.balance < order.amountUSDT) {
    return ctx.reply(
      `Insufficient balance.\n` +
      `Required: ${order.amountUSDT} USDT\n` +
      `Your balance: ${bal.balance} USDT\n\n` +
      `Run /devcredit first.`
    );
  }

  await ledger.sendLedgerTransfer({
    senderAccountId: ctx.dbUser.ledgerAccountId,
    recipientAccountId: escrow.accountId,
    amount: order.amountUSDT,
  });

  ctx.reply('✅ Deposited order amount into escrow.');
});



/* ======================================================
   START SERVER
====================================================== */

async function start() {
  await connectDB();
  bot.launch();
  console.log('🚀 Bot running');
}

start();
