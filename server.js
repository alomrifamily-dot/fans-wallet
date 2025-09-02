const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ===== Wallet module =====
const walletLimiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use("/api/wallet", walletLimiter);

const fans = new Map();
const ledger = [];

function ensureFan(fanId) {
  if (!fans.has(fanId)) {
    fans.set(fanId, {
      _id: fanId,
      wallet: { points: 0, money: 0 },
      createdAt: new Date()
    });
  }
  return fans.get(fanId);
}

function addLedger({ fanId, type, currency, amount, reason }) {
  const txn = {
    _id: "txn_" + Date.now(),
    fanId, type, currency, amount, reason,
    createdAt: new Date()
  };
  ledger.unshift(txn);
  return txn;
}

// Get wallet balance
app.get("/api/wallet/:fanId", (req, res) => {
  const fan = ensureFan(req.params.fanId);
  res.json({ ok: true, wallet: fan.wallet });
});

// Get ledger
app.get("/api/wallet/:fanId/ledger", (req, res) => {
  const { fanId } = req.params;
  const rows = ledger.filter(txn => txn.fanId === fanId);
  res.json({ ok: true, rows });
});

// Award points or money
app.post("/api/wallet/award", (req, res) => {
  const { fanId, currency, amount, reason } = req.body;
  if (!fanId || !["POINTS","MONEY"].includes(currency) || !(amount > 0)) {
    return res.status(400).json({ ok:false, error:"bad_input" });
  }
  const fan = ensureFan(fanId);
  if (currency === "POINTS") fan.wallet.points += amount;
  else fan.wallet.money += amount;
  const txn = addLedger({ fanId, type:"AWARD", currency, amount, reason });
  res.json({ ok:true, wallet: fan.wallet, txn });
});

// Redeem points
app.post("/api/wallet/redeem", (req, res) => {
  const { fanId, points, reason } = req.body;
  const fan = ensureFan(fanId);
  if (!fanId || !(points > 0)) return res.status(400).json({ ok:false, error:"bad_input" });
  if (fan.wallet.points < points) return res.status(400).json({ ok:false, error:"insufficient_points" });
  fan.wallet.points -= points;
  const txn = addLedger({ fanId, type:"REDEEM", currency:"POINTS", amount:-points, reason });
  res.json({ ok:true, wallet: fan.wallet, txn });
});

// Withdraw money
app.post("/api/wallet/withdraw", (req, res) => {
  const { fanId, amount, reason } = req.body;
  const fan = ensureFan(fanId);
  if (!fanId || !(amount > 0)) return res.status(400).json({ ok:false, error:"bad_input" });
  if (fan.wallet.money < amount) return res.status(400).json({ ok:false, error:"insufficient_funds" });
  fan.wallet.money -= amount;
  const txn = addLedger({ fanId, type:"WITHDRAW", currency:"MONEY", amount:-amount, reason });
  res.json({ ok:true, wallet: fan.wallet, txn });
});
// تحويل بين النقاط والفلوس (مثال: 100 نقطة = 1 ريال)
app.post("/api/wallet/convert", (req, res) => {
  const { fanId, direction, amount } = req.body;
  // direction = "POINTS_TO_MONEY" أو "MONEY_TO_POINTS"
  if (!fanId || !direction || !(amount > 0)) {
    return res.status(400).json({ ok: false, error: "bad_input" });
  }

  const fan = ensureFan(fanId);
  const rate = 100; // 100 نقطة = 1 ريال

  if (direction === "POINTS_TO_MONEY") {
    const requiredPoints = amount * rate;
    if (fan.wallet.points < requiredPoints) {
      return res.status(400).json({ ok: false, error: "insufficient_points" });
    }
    fan.wallet.points -= requiredPoints;
    fan.wallet.money += amount;
    const txn = addLedger({
      fanId,
      type: "CONVERT",
      currency: "MONEY",
      amount,
      reason: `Convert ${requiredPoints} points to ${amount} money`
    });
    return res.json({ ok: true, wallet: fan.wallet, txn });
  }

  if (direction === "MONEY_TO_POINTS") {
    if (fan.wallet.money < amount) {
      return res.status(400).json({ ok: false, error: "insufficient_funds" });
    }
    const points = amount * rate;
    fan.wallet.money -= amount;
    fan.wallet.points += points;
    const txn = addLedger({
      fanId,
      type: "CONVERT",
      currency: "POINTS",
      amount: points,
      reason: `Convert ${amount} money to ${points} points`
    });
    return res.json({ ok: true, wallet: fan.wallet, txn });
  }

  return res.status(400).json({ ok: false, error: "invalid_direction" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
