const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";

// =============================
// SETTINGS
// =============================

// Heartbeat every 6 hours
const HEARTBEAT_INTERVAL_HOURS = 6;

// Workflow delay warning every 3 hours
const WARNING_INTERVAL_HOURS = 3;

// Boundaries
const BG_LOWER = 11;
const BG_UPPER = 15;

const BR_LOWER = 47;
const BR_UPPER = 50;

const GR_LOWER = 33;
const GR_UPPER = 40;

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
  if (!fs.existsSync(STATE_FILE)) {
    return {
      bgState: "inside",
      brState: "inside",
      grState: "inside",
      bgLastWarning: 0,
      brLastWarning: 0,
      grLastWarning: 0,
      lastRun: 0,
      lastHeartbeat: 0,
      warningSent: false
    };
  }
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
// BOUNDARY CHECKER
// =============================
function checkBoundary(value, lower, upper, prevState, prevWarningTime, now) {
  let triggered = false;
  let newState = prevState;
  let newWarningTime = prevWarningTime;

  if (value < lower) {
    if (prevState !== "below") {
      triggered = true;
      newState = "below";
      newWarningTime = now;
    } else {
      const hours = (now - prevWarningTime) / (1000 * 60 * 60);
      if (hours >= WARNING_INTERVAL_HOURS) {
        triggered = true;
        newWarningTime = now;
      }
    }
  } else if (value > upper) {
    if (prevState !== "above") {
      triggered = true;
      newState = "above";
      newWarningTime = now;
    } else {
      const hours = (now - prevWarningTime) / (1000 * 60 * 60);
      if (hours >= WARNING_INTERVAL_HOURS) {
        triggered = true;
        newWarningTime = now;
      }
    }
  } else {
    if (prevState !== "inside") {
      triggered = true;
    }
    newState = "inside";
  }

  return { triggered, newState, newWarningTime };
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

  let sendHeartbeat = false;
  let sendWorkflowWarning = false;

  // =============================
  // WORKFLOW DELAY CHECK (3 hours)
  // =============================
  if (prev.lastRun) {
    const hoursSinceLast = (now - prev.lastRun) / (1000 * 60 * 60);
    if (hoursSinceLast >= WARNING_INTERVAL_HOURS && !prev.warningSent) {
      sendWorkflowWarning = true;
    }
  }

  // =============================
  // HEARTBEAT CHECK (6 hours)
  // =============================
  if (!prev.lastHeartbeat) {
    sendHeartbeat = true;
  } else {
    const hoursSinceHeartbeat = (now - prev.lastHeartbeat) / (1000 * 60 * 60);
    if (hoursSinceHeartbeat >= HEARTBEAT_INTERVAL_HOURS) {
      sendHeartbeat = true;
    }
  }

  // =============================
  // BOUNDARY CHECKS
  // =============================
  const bgCheck = checkBoundary(
    ratios.bg,
    BG_LOWER,
    BG_UPPER,
    prev.bgState,
    prev.bgLastWarning,
    now
  );

  const brCheck = checkBoundary(
    ratios.br,
    BR_LOWER,
    BR_UPPER,
    prev.brState,
    prev.brLastWarning,
    now
  );

  const grCheck = checkBoundary(
    ratios.gr,
    GR_LOWER,
    GR_UPPER,
    prev.grState,
    prev.grLastWarning,
    now
  );

  // =============================
  // MESSAGE TEMPLATE
  // =============================
  const baseMsg = `${prices.source}: BG ${ratios.bg} | BR ${ratios.br} | GR ${ratios.gr}`;

  // =============================
  // SEND MESSAGES
  // =============================
  if (sendWorkflowWarning) {
    await sendTelegram(baseMsg);
  }

  if (sendHeartbeat) {
    await sendTelegram(baseMsg);
  }

  if (bgCheck.triggered) {
    await sendTelegram(`${baseMsg} (BG)`);
  }

  if (brCheck.triggered) {
    await sendTelegram(`${baseMsg} (BR)`);
  }

  if (grCheck.triggered) {
    await sendTelegram(`${baseMsg} (GR)`);
  }

  // =============================
  // SAVE STATE
  // =============================
  saveState({
    ...ratios,
    lastRun: now,
    lastHeartbeat: sendHeartbeat ? now : prev.lastHeartbeat,
    warningSent: sendWorkflowWarning ? true : prev.warningSent,

    bgState: bgCheck.newState,
    brState: brCheck.newState,
    grState: grCheck.newState,

    bgLastWarning: bgCheck.newWarningTime,
    brLastWarning: brCheck.newWarningTime,
    grLastWarning: grCheck.newWarningTime
  });
}

main();
