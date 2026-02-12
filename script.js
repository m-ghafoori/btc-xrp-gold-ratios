const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";

// =============================
// NEW SETTINGS
// =============================

// Heartbeat every 6 hours
const HEARTBEAT_INTERVAL_HOURS = 6;

// Warning if workflow delayed by 3 hours
const WARNING_INTERVAL_HOURS = 3;

// Boundary system
const LOWER_BOUND = 32;
const UPPER_BOUND = 38;

// =============================
// API FETCH FUNCTIONS
// =============================

async function fetchFromNobitex() {
  const url = "https://api.nobitex.ir/market/stats?srcCurrency=btc,xrp&dstCurrency=usdt";
  const data = (await axios.get(url)).data;

  return {
    source: "Nobitex",
    btc: parseFloat(data.stats["btc-usdt"].bestSell),
    xrp: parseFloat(data.stats["xrp-usdt"].bestSell),
    gold: null
  };
}

async function fetchFromCoingecko() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ripple,tether-gold&vs_currencies=usd";

  const data = (await axios.get(url)).data;

  return {
    source: "CoinGecko",
    btc: data.bitcoin.usd,
    xrp: data.ripple.usd,
    gold: data["tether-gold"].usd
  };
}

async function fetchFromCoinpaprika() {
  const btc = (await axios.get("https://api.coinpaprika.com/v1/tickers/btc-bitcoin")).data.quotes.USD.price;
  const xrp = (await axios.get("https://api.coinpaprika.com/v1/tickers/xrp-xrp")).data.quotes.USD.price;

  return {
    source: "CoinPaprika",
    btc,
    xrp,
    gold: null
  };
}

async function fetchFromBinance() {
  const btc = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")).data.price);
  const xrp = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT")).data.price);

  return {
    source: "Binance",
    btc,
    xrp,
    gold: null
  };
}

// =============================
// PRICE FETCHER WITH PRIORITY ORDER
// =============================
async function fetchPrices() {
  const apis = [
    fetchFromNobitex,
    fetchFromCoingecko,
    fetchFromCoinpaprika,
    fetchFromBinance
  ];

  for (const api of apis) {
    try {
      return await api();
    } catch (e) {
      continue;
    }
  }

  throw new Error("All APIs failed");
}

// =============================
// RATIO CALCULATION
// =============================
function truncate(x) {
  return Math.floor(x);
}

function calculateRatios(btc, xrp, gold) {
  return {
    bg: gold ? truncate(btc / gold) : null,
    br: truncate((btc / xrp) / 1000),
    gr: gold ? truncate((gold / xrp) / 100) : null
  };
}

// =============================
// STATE HANDLING
// =============================
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// =============================
// TELEGRAM SENDER
// =============================
async function sendTelegram(text) {
  const bot = process.env.TELEGRAM_BOT;
  const chat = process.env.TELEGRAM_CHAT;

  if (!bot || !chat) {
    console.error("Telegram bot token or chat ID missing");
    return;
  }

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chat,
      text
    });
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
  }
}

// =============================
// MAIN LOGIC
// =============================
async function main() {
  let prices;

  try {
    prices = await fetchPrices();
  } catch (e) {
    await sendTelegram("FetchError: BG null | BR null | GR null");
    return;
  }

  const ratios = calculateRatios(prices.btc, prices.xrp, prices.gold);
  const now = Date.now();
  const prev = loadState();

  let sendWarning = false;
  let sendHeartbeat = false;
  let boundaryTriggered = false;

  // =============================
  // WORKFLOW DELAY CHECK (3 hours)
  // =============================
  if (prev && prev.lastRun) {
    const hoursSinceLast = (now - prev.lastRun) / (1000 * 60 * 60);
    if (hoursSinceLast >= WARNING_INTERVAL_HOURS && !prev.warningSent) {
      sendWarning = true;
    }
  }

  // =============================
  // HEARTBEAT CHECK (6 hours)
  // =============================
  if (!prev || !prev.lastHeartbeat) {
    sendHeartbeat = true;
  } else {
    const hoursSinceHeartbeat = (now - prev.lastHeartbeat) / (1000 * 60 * 60);
    if (hoursSinceHeartbeat >= HEARTBEAT_INTERVAL_HOURS) {
      sendHeartbeat = true;
    }
  }

  // =============================
  // BOUNDARY LOGIC
  // =============================
  let lastState = prev ? prev.state : "inside";

  if (ratios.gr < LOWER_BOUND) {
    if (lastState !== "below") {
      boundaryTriggered = true;
      lastState = "below";
    } else {
      const hoursSinceWarning = (now - (prev ? prev.lastWarning : 0)) / (1000 * 60 * 60);
      if (hoursSinceWarning >= WARNING_INTERVAL_HOURS) {
        boundaryTriggered = true;
      }
    }
  } else if (ratios.gr > UPPER_BOUND) {
    if (lastState !== "above") {
      boundaryTriggered = true;
      lastState = "above";
    } else {
      const hoursSinceWarning = (now - (prev ? prev.lastWarning : 0)) / (1000 * 60 * 60);
      if (hoursSinceWarning >= WARNING_INTERVAL_HOURS) {
        boundaryTriggered = true;
      }
    }
  } else {
    if (lastState !== "inside") {
      boundaryTriggered = true;
    }
    lastState = "inside";
  }

  // =============================
  // MESSAGE FORMAT
  // =============================
  const msg = `${prices.source}: BG ${ratios.bg} | BR ${ratios.br} | GR ${ratios.gr}`;

  // =============================
  // SEND MESSAGES
  // =============================
  if (sendWarning) {
    await sendTelegram(msg);
  }

  if (sendHeartbeat) {
    await sendTelegram(msg);
  }

  if (boundaryTriggered) {
    await sendTelegram(msg);
  }

  // =============================
  // SAVE STATE
  // =============================
  saveState({
    ...ratios,
    lastRun: now,
    lastHeartbeat: sendHeartbeat ? now : (prev ? prev.lastHeartbeat : now),
    lastWarning: boundaryTriggered ? now : (prev ? prev.lastWarning : now),
    warningSent: sendWarning ? true : false,
    state: lastState
  });
}

main();
