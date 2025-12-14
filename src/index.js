// src/index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const connectDB = require('./db');
const User = require('./models/User');
const Order = require('./models/Order');
const EscrowWallet = require('./models/EscrowWallet');
const tatum = require('./tatumLedger');

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error('BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// In-memory sessions
const sessions = new Map();
function getSession(ctx) {
  const chatId = ctx.chat.id;
  if (!sessions.has(chatId)) sessions.set(chatId, { mode: null, step: null, orderDraft: null, orderId: null });
  return sessions.get(chatId);
}
function clearSession(ctx) { sessions.delete(ctx.chat.id); }

// Post to public feed (optional)
async function postToFeed(text) {
  const feedChatId = process.env.PUBLIC_FEED_CHAT_ID;
  if (!feedChatId) return;
  try { await bot.telegram.sendMessage(feedChatId, text, { parse_mode: 'Markdown' }); }
  catch (err) { console.error('Error posting to feed:', err.message); }
}

// Auto-register user & ensure ledger account
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const telegramId = String(ctx.from.id);
    try {
      let user = await User.findOne({ telegramId });
      if (!user) {
        user = await User.create({
          telegramId,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        });
        console.log('👤 New user registered:', telegramId);
      }
      // Ensure user ledger VA exists and save id
      try {
        const acc = await tatum.ensureUserLedgerAccount(telegramId, process.env.TATUM_VA_CURRENCY || 'USDT');
        if (acc && acc.id) {
          if (!user.ledgerAccountId) {
            user.ledgerAccountId = acc.id || acc.accountId || acc.account;
            await user.save();
            console.log('Saved user ledgerAccountId for', telegramId, user.ledgerAccountId);
          } else if (user.ledgerAccountId !== (acc.id || acc.accountId || acc.account)) {
            // keep existing but update if changed
            user.ledgerAccountId = acc.id || acc.accountId || acc.account;
            await user.save();
          }
        }
      } catch (e) {
        console.warn('Could not ensure user ledger account:', e.message);
      }
      ctx.dbUser = user;
    } catch (err) {
      console.error('User middleware error:', err.message);
    }
  }
  return next();
});

// Helper to find buyer/seller
function getBuyerSeller(order) {
  let buyerTelegramId, sellerTelegramId;
  if (order.type === 'SELL') {
    sellerTelegramId = order.creatorTelegramId;
    buyerTelegramId = order.takerTelegramId;
  } else {
    buyerTelegramId = order.creatorTelegramId;
    sellerTelegramId = order.takerTelegramId;
  }
  return { buyerTelegramId, sellerTelegramId };
}

// /start
bot.start(async (ctx) => {
  const name = ctx.from.first_name || ctx.from.username || 'friend';
  await ctx.reply(
    `Hey ${name}! 👋\n\nWelcome to the *P2P USDT Bot (Tatum VA mode)*.\n\nCommands:\n• /sell – create a SELL order\n• /buy – create a BUY order\n• /orders – view open orders\n• /myorders – view your orders\n• /balance – show your VA balance\n• /escrowbalance – show escrow balance (admin/dev)\n`,
    { parse_mode: 'Markdown' }
  );
});

// /sell
bot.command('sell', async (ctx) => {
  const s = getSession(ctx);
  s.mode = 'SELL';
  s.step = 'ASK_NETWORK';
  s.orderDraft = { type: 'SELL', creatorTelegramId: String(ctx.from.id) };
  await ctx.reply(`Creating *SELL* order.\nReply with *ERC20* or *TRC20*.`, { parse_mode: 'Markdown' });
});

// /buy
bot.command('buy', async (ctx) => {
  const s = getSession(ctx);
  s.mode = 'BUY';
  s.step = 'ASK_NETWORK';
  s.orderDraft = { type: 'BUY', creatorTelegramId: String(ctx.from.id) };
  await ctx.reply(`Creating *BUY* order.\nReply with *ERC20* or *TRC20*.`, { parse_mode: 'Markdown' });
});

// /orders
bot.command('orders', async (ctx) => {
  const orders = await Order.find({ status: 'OPEN' }).sort({ createdAt: -1 });
  if (orders.length === 0) return ctx.reply('No open orders right now.');
  let msg = '*Open Orders:*\n\n';
  for (const o of orders) {
    msg += `ID: \`${o._id}\`\nType: *${o.type}* | Network: *${o.network}*\nAmount: *${o.amountUSDT} USDT* | Fiat: *${o.fiatCurrency}* (${o.fiatMethod})\nStatus: \`${o.status}\`\n———\n`;
  }
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /myorders
bot.command('myorders', async (ctx) => {
  const orders = await Order.find({ creatorTelegramId: String(ctx.from.id) }).sort({ createdAt: -1 });
  if (orders.length === 0) return ctx.reply('You have no orders yet.');
  let msg = '*Your Orders:*\n\n';
  for (const o of orders) {
    msg += `ID: \`${o._id}\`\nType: *${o.type}* | Network: *${o.network}*\nAmount: *${o.amountUSDT} USDT*\nStatus: \`${o.status}\`\n———\n`;
  }
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /take <orderId>
bot.command('take', async (ctx) => {
  const parts = ctx.message.text.trim().split(' ');
  const orderId = parts[1];
  if (!orderId) return ctx.reply('Usage: /take <orderId>\n\nYou can get the ID from /orders.');
  try {
    const order = await Order.findById(orderId);
    if (!order) return ctx.reply('Order not found. Check the ID and try again.');
    if (order.status !== 'OPEN') return ctx.reply(`This order is not OPEN. Current status: ${order.status}`);
    const takerId = String(ctx.from.id);
    if (takerId === order.creatorTelegramId) {
      console.log('DEV: taker is also creator, allowing self-take for testing.');
    }
    order.takerTelegramId = takerId;
    order.status = 'MATCHED';
    // ensure taker ledger id saved
    const takerUser = await User.findOne({ telegramId: takerId });
    if (takerUser && !takerUser.ledgerAccountId) {
      const acc = await tatum.ensureUserLedgerAccount(takerId, process.env.TATUM_VA_CURRENCY || 'USDT');
      takerUser.ledgerAccountId = acc.id || acc.accountId || acc.account;
      await takerUser.save();
    }
    // set buyer/seller ledger ids
    if (order.type === 'SELL') {
      order.buyerLedgerAccountId = takerUser?.ledgerAccountId;
      // seller ledger id (creator)
      const sellerUser = await User.findOne({ telegramId: order.creatorTelegramId });
      if (sellerUser && sellerUser.ledgerAccountId) order.sellerLedgerAccountId = sellerUser.ledgerAccountId;
    } else {
      // BUY order - taker is seller
      order.sellerLedgerAccountId = takerUser?.ledgerAccountId;
      const buyerUser = await User.findOne({ telegramId: order.creatorTelegramId });
      if (buyerUser && buyerUser.ledgerAccountId) order.buyerLedgerAccountId = buyerUser.ledgerAccountId;
    }
    await order.save();

    const { buyerTelegramId, sellerTelegramId } = getBuyerSeller(order);

    await ctx.reply(
      `You have *matched* this order.\n\nOrder ID: \`${order._id}\`\nType: *${order.type}* | Network: *${order.network}*\nAmount: *${order.amountUSDT} USDT*\nFiat: *${order.fiatCurrency}* (${order.fiatMethod})\n\nOnce you send fiat to the other party, run:\n\`/markpaid ${order._id}\``,
      { parse_mode: 'Markdown' }
    );

    await bot.telegram.sendMessage(
      order.creatorTelegramId,
      ` Your order has been *taken*.\n\nOrder ID: \`${order._id}\`\nThe counterparty has joined this trade.\nAfter you receive fiat, ask them to run: \`/markpaid ${order._id}\`. Then you will run: \`/release ${order._id}\` to complete the trade.`,
      { parse_mode: 'Markdown' }
    );

    // If SELL+VA: instruct seller to deposit from their VA to escrow
    if (order.type === 'SELL') {
      const escrowDoc = await EscrowWallet.findOne({ role: 'ESCROW_MASTER', network: process.env.TATUM_VA_CURRENCY || 'USDT' });
      const sellerUser = await User.findOne({ telegramId: order.creatorTelegramId });
      await bot.telegram.sendMessage(order.creatorTelegramId,
        `Please deposit *${order.amountUSDT} USDT* from your in-app ledger account to escrow:\n\n` +
        `Your ledger id: ${sellerUser?.ledgerAccountId}\n` +
        `Escrow ledger id: ${escrowDoc?.ledgerAccountId}\n\n` +
        `Dev instruction: run the bot command /devdeposit <orderId> from your account to simulate the deposit (dev only).`);
    }

  } catch (err) {
    console.error('Error in /take:', err);
    await ctx.reply('Something went wrong while taking this order.');
  }
});

// /markpaid <orderId>
bot.command('markpaid', async (ctx) => {
  const parts = ctx.message.text.trim().split(' ');
  const orderId = parts[1];
  if (!orderId) return ctx.reply('Usage: /markpaid <orderId>');
  try {
    const order = await Order.findById(orderId);
    if (!order) return ctx.reply('Order not found.');
    if (order.status !== 'MATCHED') return ctx.reply(`This order is not in MATCHED state. Current status: ${order.status}`);
    const callerId = String(ctx.from.id);
    const { buyerTelegramId, sellerTelegramId } = getBuyerSeller(order);
    if (!buyerTelegramId || !sellerTelegramId) return ctx.reply('This order does not have both parties set yet.');
    if (callerId !== buyerTelegramId) return ctx.reply('Only the buyer can mark this order as paid.');
    order.status = 'PAID';
    await order.save();
    await ctx.reply(`Marked as *PAID*.\n\nOrder ID: \`${order._id}\`.\nThe seller can now run /release ${order._id} after confirming fiat.`, { parse_mode: 'Markdown' });
    await bot.telegram.sendMessage(sellerTelegramId, `Buyer has marked order as *PAID*.\nOrder ID: \`${order._id}\`.\nPlease verify you received fiat off-platform. If yes, run: \`/release ${order._id}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error in /markpaid:', err);
    await ctx.reply('Something went wrong while marking as paid.');
  }
});

// /release <orderId>
bot.command('release', async (ctx) => {
  const parts = ctx.message.text.trim().split(' ');
  const orderId = parts[1];
  if (!orderId) return ctx.reply('Usage: /release <orderId>');
  try {
    const order = await Order.findById(orderId);
    if (!order) return ctx.reply('Order not found.');
    if (order.status !== 'PAID') return ctx.reply(`This order is not in PAID state. Current status: ${order.status}`);
    const callerId = String(ctx.from.id);
    const { buyerTelegramId, sellerTelegramId } = getBuyerSeller(order);
    if (!buyerTelegramId || !sellerTelegramId) return ctx.reply('This order does not have both parties set yet.');
    if (callerId !== sellerTelegramId) return ctx.reply('Only the seller can release USDT for this order.');

    // Ensure escrow/account info
    if (!order.escrowLedgerAccountId) {
      const escrowDoc = await EscrowWallet.findOne({ role: 'ESCROW_MASTER', network: process.env.TATUM_VA_CURRENCY || 'USDT' });
      if (!escrowDoc) return ctx.reply('Escrow account not configured. Admin must run seed script.');
      order.escrowLedgerAccountId = escrowDoc.ledgerAccountId;
    }
    if (!order.buyerLedgerAccountId) {
      const buyerUser = await User.findOne({ telegramId: buyerTelegramId });
      if (!buyerUser || !buyerUser.ledgerAccountId) return ctx.reply('Buyer ledger account missing. Ask buyer to interact with bot or admin to credit.');
      order.buyerLedgerAccountId = buyerUser.ledgerAccountId;
    }
    if (!order.sellerLedgerAccountId) {
      const sellerUser = await User.findOne({ telegramId: sellerTelegramId });
      if (sellerUser && sellerUser.ledgerAccountId) order.sellerLedgerAccountId = sellerUser.ledgerAccountId;
    }
    await order.save();

    // Do VA transfers (escrow -> buyer 95%, escrow -> fee 5%)
    const amount = Number(order.amountUSDT);
    const feePct = Number(process.env.P2P_FEE_PERCENT || 5);
    const feeAmount = (amount * feePct) / 100;
    const sendAmount = Number((amount - feeAmount).toFixed(6));

    await ctx.reply('⏳ Performing ledger transfers (escrow -> buyer + fee) ...');

    // actual transfers
    const releaseRes = await tatum.sendLedgerTransfer({
      senderAccountId: order.escrowLedgerAccountId,
      recipientAccountId: order.buyerLedgerAccountId,
      amount: sendAmount,
      paymentId: `release_${order._id}`,
      senderNote: `Release ${order._id}`,
      recipientNote: `Release from order ${order._id}`,
    });

    const feeDoc = await EscrowWallet.findOne({ role: 'FEE', network: process.env.TATUM_VA_CURRENCY || 'USDT' });
    if (!feeDoc) throw new Error('Fee account not configured');
    const feeRes = await tatum.sendLedgerTransfer({
      senderAccountId: order.escrowLedgerAccountId,
      recipientAccountId: feeDoc.ledgerAccountId,
      amount: feeAmount,
      paymentId: `fee_${order._id}`,
      senderNote: `Fee ${order._id}`,
      recipientNote: `Fee for order ${order._id}`,
    });

    order.releaseTxRef = releaseRes.reference || JSON.stringify(releaseRes);
    order.feeTxRef = feeRes.reference || JSON.stringify(feeRes);
    order.status = 'RELEASED';
    await order.save();

    let sellerMsg = `You have *released* this order.\n\nOrder ID: \`${order._id}\`\nStatus is now: *RELEASED*`;
    if (order.releaseTxRef) sellerMsg += `\n\nReference: \`${order.releaseTxRef}\``;
    await ctx.reply(sellerMsg, { parse_mode: 'Markdown' });

    let buyerMsg = `Seller has *released* the order.\n\nOrder ID: \`${order._id}\`\nStatus: *RELEASED*.\n`;
    if (order.releaseTxRef) buyerMsg += `\nReference: \`${order.releaseTxRef}\``;
    await bot.telegram.sendMessage(buyerTelegramId, buyerMsg, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Error in /release:', err);
    await ctx.reply('Something went wrong while releasing this order: ' + (err.message || err));
  }
});

// Dev: depositcheck <orderId>
bot.command('depositcheck', async (ctx) => {
  const parts = ctx.message.text.trim().split(' ');
  const orderId = parts[1];
  if (!orderId) return ctx.reply('Usage: /depositcheck <orderId>');
  try {
    const order = await Order.findById(orderId);
    if (!order) return ctx.reply('Order not found');
    if (!order.escrowLedgerAccountId) return ctx.reply('No escrow ledger assigned to this order.');
    const acc = await tatum.getAccountById(order.escrowLedgerAccountId);
    return ctx.reply('Escrow account data:\n' + '```' + JSON.stringify(acc, null, 2) + '```', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    await ctx.reply('Error checking escrow balance: ' + (err.message || err));
  }
});

// Dev: simulate deposit (from current user VA -> escrow)
bot.command('devdeposit', async (ctx) => {
  const parts = ctx.message.text.trim().split(' ');
  const orderId = parts[1];
  if (!orderId) return ctx.reply('Usage: /devdeposit <orderId>');
  try {
    const order = await Order.findById(orderId);
    if (!order) return ctx.reply('Order not found');
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user || !user.ledgerAccountId) return ctx.reply('User ledger account missing');
    if (!order.escrowLedgerAccountId) {
      const escrowDoc = await EscrowWallet.findOne({ role: 'ESCROW_MASTER', network: process.env.TATUM_VA_CURRENCY || 'USDT' });
      if (!escrowDoc) return ctx.reply('Escrow not configured. Run seed script.');
      order.escrowLedgerAccountId = escrowDoc.ledgerAccountId;
      await order.save();
    }
    const res = await tatum.sendLedgerTransfer({
      senderAccountId: user.ledgerAccountId,
      recipientAccountId: order.escrowLedgerAccountId,
      amount: order.amountUSDT,
      paymentId: `deposit_${order._id}`,
      senderNote: `Deposit for ${order._id}`,
      recipientNote: `Deposit for ${order._id}`,
    });
    order.escrowDepositTxRef = res.reference || JSON.stringify(res);
    await order.save();
    return ctx.reply('Deposit simulated and recorded: ' + JSON.stringify(res));
  } catch (err) {
    console.error(err);
    return ctx.reply('Deposit failed: ' + (err.message || err));
  }
});

// /balance - show user's ledger balance
bot.command('balance', async (ctx) => {
  try {
    const user = ctx.dbUser;
    if (!user || !user.ledgerAccountId) {
      return ctx.reply('Your ledger account not found. Interact once and try again.');
    }
    
    const balanceInfo = await tatum.getAccountBalance(user.ledgerAccountId);
    const balance = parseFloat(balanceInfo.balance || '0');
    const currency = balanceInfo.currency || 'USDT';
    
    return ctx.reply(
      `*Your Balance*\n\n` +
      `Currency: *${currency}*\n` +
      `Balance: *${balance.toFixed(6)} ${currency}*\n\n` +
      `Account ID: \`${balanceInfo.accountId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Balance error:', err);
    await ctx.reply('Error fetching balance: ' + (err.message || err));
  }
});

// /escrowbalance - show escrow master balance
bot.command('escrowbalance', async (ctx) => {
  try {
    const currency = process.env.TATUM_VA_CURRENCY || 'USDT';
    const escrowDoc = await EscrowWallet.findOne({ role: 'ESCROW_MASTER', network: currency });
    
    if (!escrowDoc) {
      return ctx.reply('Escrow MASTER not configured. Admin: run `scripts/seedLedgerMasterAccounts.js`');
    }
    
    if (!escrowDoc.ledgerAccountId) {
      return ctx.reply('Escrow MASTER ledger account ID missing. Admin: run `scripts/seedLedgerMasterAccounts.js`');
    }
    
    const balanceInfo = await tatum.getAccountBalance(escrowDoc.ledgerAccountId);
    const balance = parseFloat(balanceInfo.balance || '0');
    const balanceCurrency = balanceInfo.currency || currency;
    
    return ctx.reply(
      `*Escrow Balance*\n\n` +
      `Currency: *${balanceCurrency}*\n` +
      `Balance: *${balance.toFixed(6)} ${balanceCurrency}*\n\n` +
      `Account ID: \`${balanceInfo.accountId}\`\n` +
      `Role: *ESCROW_MASTER*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Escrow balance error:', err);
    await ctx.reply('Error fetching escrow balance: ' + (err.message || err));
  }
});

// Multi-step text handling
bot.on('text', async (ctx) => {
  const s = getSession(ctx);
  if (!s || !s.mode) return;
  const text = ctx.message.text.trim();
  try {
    if (s.step === 'ASK_NETWORK') {
      const net = text.toUpperCase();
      if (net !== 'ERC20' && net !== 'TRC20') return ctx.reply('Please reply with *ERC20* or *TRC20*.', { parse_mode: 'Markdown' });
      s.orderDraft.network = net;
      s.step = 'ASK_AMOUNT';
      return ctx.reply('How much USDT? (e.g. `100`)', { parse_mode: 'Markdown' });
    }
    if (s.step === 'ASK_AMOUNT') {
      const amt = Number(text);
      if (!amt || amt <= 0) return ctx.reply('Reply with a valid positive number.');
      s.orderDraft.amountUSDT = amt;
      s.step = 'ASK_FIAT_CURRENCY';
      return ctx.reply('Fiat currency? (e.g. `INR`)', { parse_mode: 'Markdown' });
    }
    if (s.step === 'ASK_FIAT_CURRENCY') {
      s.orderDraft.fiatCurrency = text.toUpperCase();
      s.step = 'ASK_FIAT_METHOD';
      return ctx.reply('Fiat method? (e.g. `UPI`, `BANK`)', { parse_mode: 'Markdown' });
    }
    if (s.step === 'ASK_FIAT_METHOD') {
      s.orderDraft.fiatMethod = text.toUpperCase();
      try {
        // Get escrow master ledger id from DB
        const escrowDoc = await EscrowWallet.findOne({ role: 'ESCROW_MASTER', network: process.env.TATUM_VA_CURRENCY || 'USDT' });
        if (!escrowDoc) {
          return ctx.reply('System not initialized. Admin: run scripts/seedLedgerMasterAccounts.js');
        }
        // Save order
        const order = await Order.create({
          creatorTelegramId: s.orderDraft.creatorTelegramId,
          type: s.orderDraft.type,
          network: s.orderDraft.network,
          amountUSDT: s.orderDraft.amountUSDT,
          fiatCurrency: s.orderDraft.fiatCurrency,
          fiatMethod: s.orderDraft.fiatMethod,
          escrowLedgerAccountId: escrowDoc.ledgerAccountId,
          sellerLedgerAccountId: ctx.dbUser?.ledgerAccountId,
        });

        let summary = `*Order Created!*\n\nID: \`${order._id}\`\nType: *${order.type}*\nNetwork: *${order.network}*\nAmount: *${order.amountUSDT} USDT*\nFiat: *${order.fiatCurrency}* (${order.fiatMethod})\nStatus: \`${order.status}\``;
        summary += `\n\n*Escrow ledger id*:\n\`${order.escrowLedgerAccountId}\`\n\nDeposit instructions: transfer from your in-app VA to the escrow VA. For dev, run:\n\`/devdeposit ${order._id}\``;

        await ctx.reply(summary, { parse_mode: 'Markdown' });
        await postToFeed(`New *${order.type}* order\nNetwork: *${order.network}*\nAmount: *${order.amountUSDT} USDT*\nFiat: *${order.fiatCurrency}* (${order.fiatMethod})\nOrder ID: \`${order._id}\``);
      } catch (err) {
        console.error('Error creating order with escrow:', err);
        await ctx.reply('Something went wrong while creating your order.');
      } finally {
        clearSession(ctx);
      }
      return;
    }
  } catch (err) {
    console.error(err);
    clearSession(ctx);
    ctx.reply('Something went wrong. Try again.');
  }
});

async function start() {
  await connectDB();
  console.log('Starting Telegram bot...');
  bot.launch();
}

start();
