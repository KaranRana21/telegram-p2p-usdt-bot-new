# How to Run and Test the Telegram P2P USDT Bot

## Prerequisites Check

1. **MongoDB is running:**
   ```bash
   brew services list | grep mongodb
   # Should show: mongodb-community@7.0 started
   ```

2. **Environment variables are set:**
   - Check that `.env` file exists with all required variables
   - Verify `BOT_TOKEN` and `TATUM_API_KEY` are set

3. **Dependencies are installed:**
   ```bash
   npm install
   ```

## Step 1: Seed Escrow Accounts (First Time Only)

Before running the bot, you need to seed the escrow accounts. You have two options:

### Option A: Automatic Seeding (if Tatum API allows)
```bash
npm run seed
# or
node scripts/seedLedgerMasterAccounts.js
```

### Option B: Manual Seeding (if you have account IDs from Tatum dashboard)
1. Add to your `.env` file:
   ```
   MANUAL_ESCROW_ACCOUNT_ID=your_escrow_account_id
   MANUAL_FEE_ACCOUNT_ID=your_fee_account_id
   MANUAL_FUNDING_ACCOUNT_ID=your_funding_account_id
   ```

2. Run:
   ```bash
   node scripts/manualSeedAccounts.js
   ```

### Verify Accounts Were Seeded:
```bash
npm run list-escrows
# or
node scripts/listEscrows.js
```

You should see ESCROW_MASTER, FEE, and FUNDING accounts.

## Step 2: Start the Bot

```bash
npm start
# or
node src/index.js
```

You should see:
```
Connected to MongoDB
Starting Telegram bot...
```

The bot is now running and listening for commands!

## Step 3: Test the Bot in Telegram

1. **Open Telegram** and find your bot (search for the bot username associated with your `BOT_TOKEN`)

2. **Send `/start`** - You should get a welcome message with available commands

3. **Test Balance Command:**
   ```
   /balance
   ```
   - Should show your account balance (or error if account not created yet)
   - First time: Bot will auto-create your ledger account

4. **Test Escrow Balance:**
   ```
   /escrowbalance
   ```
   - Should show escrow master balance
   - Will error if accounts weren't seeded properly

5. **Test Creating an Order:**
   ```
   /sell
   ```
   - Follow the prompts:
     - Reply: `ERC20`
     - Reply: `100` (or any amount)
     - Reply: `USD` (or any currency)
     - Reply: `BANK` (or any method)
   - Should create an order successfully

6. **View Orders:**
   ```
   /orders
   ```
   - Shows all open orders

   ```
   /myorders
   ```
   - Shows your orders

## Step 4: Check Logs

Watch the terminal where the bot is running. You should see:
- User registration messages
- Order creation logs
- Any errors (these will help debug issues)

## Common Issues & Solutions

### Issue: "Escrow MASTER not configured"
**Solution:** Run the seed script first:
```bash
npm run seed
```

### Issue: "Error fetching balance: Access to this feature is limited..."
**Solution:** Your Tatum API key needs Virtual Account access. Either:
- Enable Virtual Accounts in Tatum dashboard
- Use manual seeding with account IDs from dashboard
- Upgrade your Tatum plan

### Issue: "MongoDB connection error"
**Solution:** Start MongoDB:
```bash
brew services start mongodb-community@7.0
```

### Issue: Bot not responding
**Solution:** 
- Check that bot is running (look at terminal)
- Verify `BOT_TOKEN` in `.env` is correct
- Make sure you're messaging the correct bot in Telegram

## Testing Checklist

- [ ] MongoDB is running
- [ ] `.env` file has all required variables
- [ ] Escrow accounts are seeded (`npm run list-escrows`)
- [ ] Bot starts without errors (`npm start`)
- [ ] `/start` command works in Telegram
- [ ] `/balance` command works (may need to interact first)
- [ ] `/escrowbalance` command works
- [ ] `/sell` command creates orders
- [ ] `/orders` shows created orders

## Stopping the Bot

Press `Ctrl+C` in the terminal where the bot is running.

