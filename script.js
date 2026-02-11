const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";

// Heartbeat every 48 minutes
const HEARTBEAT_INTERVAL_HOURS = 0.8; // 48 minutes

// Warning if workflow delayed by 27+ minutes
const WARNING_INTERVAL_HOURS = 0.45; // 27 minutes

// -----------------------------
// API FETCH FUNCTIONS
// -----------------------------

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

// -----------------------------
// PRICE FETCHER WITH PRIORITY ORDER
// -----------------------------
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

// -----------------------------
// RATIO CALCULATION
// -----------------------------
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

// -----------------------------
// STATE HANDLING
// -----------------------------
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// -----------------------------
// TELEGRAM SENDER
// -----------------------------
async function sendTelegram(msg) {
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
      text: msg
    });
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
  }
}

// -----------------------------
// MAIN LOGIC
// -----------------------------
async function main() {
  let prices;

  // Try all APIs safely
  try {
    prices = await fetchPrices();
  } catch (e) {
    await sendTelegram("⚠️ All APIs failed to fetch prices");
    return;
  }

  const ratios = calculateRatios(prices.btc, prices.xrp, prices.gold);
  const now = Date.now();
  const prev = loadState();

  let sendWarning = false;
  let sendHeartbeat = false;

  // -----------------------------
  // TIMESTAMP DELAY CHECK (24 min)
  // -----------------------------
  if (prev && prev.lastRun) {
    const hoursSinceLast = (now - prev.lastRun) / (1000 * 60 * 60);

    if (hoursSinceLast >= WARNING_INTERVAL_HOURS && !prev.warningSent) {
      sendWarning = true;
    }
  }

  // -----------------------------
  // HEARTBEAT CHECK (48 min)
  // -----------------------------
  if (!prev || !prev.lastHeartbeat) {
    sendHeartbeat = true;
  } else {
    const hoursSinceHeartbeat = (now - prev.lastHeartbeat) / (1000 * 60 * 60);
    if (hoursSinceHeartbeat >= HEARTBEAT_INTERVAL_HOURS) {
      sendHeartbeat = true;
    }
  }

  // -----------------------------
  // RATIO CHANGE DETECTION
  // -----------------------------
  const ratiosChanged =
    !prev ||
    prev.bg !== ratios.bg ||
    prev.br !== ratios.br ||
    prev.gr !== ratios.gr;

  // -----------------------------
  // SEND MESSAGES
  // -----------------------------
  if (sendWarning) {
    const hoursSinceLast = (now - prev.lastRun) / (1000 * 60 * 60);
    await sendTelegram(
      ` <!--EZBOT--> ⚠️ Warning: Workflow did not run for ${hoursSinceLast.toFixed(2)} hours`
    );
  }

  if (sendHeartbeat) {
    await sendTelegram(
      ` <!--EZBOT--> 💓 Heartbeat\n${prices.source} | B/G: ${ratios.bg} | B/R: ${ratios.br} | G/R: ${ratios.gr}`
    );
  }

  if (ratiosChanged) {
    await sendTelegram(
      ` <!--EZBOT--> ${prices.source} | B/G: ${ratios.bg} | B/R: ${ratios.br} | G/R: ${ratios.gr}`
    );
  }

  // -----------------------------
  // SAVE STATE
  // -----------------------------
  saveState({
    ...ratios,
    lastRun: now,
    lastHeartbeat: sendHeartbeat ? now : (prev ? prev.lastHeartbeat : now),
    warningSent: sendWarning ? true : false
  });
}

main();
