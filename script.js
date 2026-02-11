const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";
const HEARTBEAT_INTERVAL_HOURS = 24;

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

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;
  await axios.post(url, {
    chat_id: chat,
    text: msg
  });
}

// -----------------------------
// MAIN LOGIC WITH HEARTBEAT
// -----------------------------
async function main() {
  let prices;

  try {
    prices = await fetchPrices();
  } catch (e) {
    await sendTelegram("⚠️ All APIs failed to fetch prices");
    return;
  }

  const ratios = calculateRatios(prices.btc, prices.xrp, prices.gold);
  const now = Date.now();
  const prev = loadState();

  let shouldSendHeartbeat = false;

  if (!prev || !prev.lastHeartbeat) {
    shouldSendHeartbeat = true;
  } else {
    const hoursSinceLast = (now - prev.lastHeartbeat) / (1000 * 60 * 60);
    if (hoursSinceLast >= HEARTBEAT_INTERVAL_HOURS) {
      shouldSendHeartbeat = true;
    }
  }

  const ratiosChanged =
    !prev ||
    prev.bg !== ratios.bg ||
    prev.br !== ratios.br ||
    prev.gr !== ratios.gr;

  if (shouldSendHeartbeat) {
    await sendTelegram(
      `💓 Heartbeat\n${prices.source} | B/G: ${ratios.bg} | B/R: ${ratios.br} | G/R: ${ratios.gr}`
    );
  } else if (ratiosChanged) {
    await sendTelegram(
      `${prices.source} | B/G: ${ratios.bg} | B/R: ${ratios.br} | G/R: ${ratios.gr}`
    );
  }

  saveState({
    ...ratios,
    lastHeartbeat: now
  });
}

main();
