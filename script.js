const axios = require("axios");

// =============================
// SETTINGS
// =============================

// Heartbeat windows (24h format)
const HEARTBEAT_WINDOWS = [
  [8, 10],
  [14, 16],
  [20, 22]
];

// Boundaries
const BG_LOWER = 11;
const BG_UPPER = 15;

const BR_LOWER = 46;
const BR_UPPER = 50;

const GR_LOWER = 32;
const GR_UPPER = 37;

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
// HEARTBEAT CHECK
// =============================
function isHeartbeatTime() {
  const hour = new Date().getHours();

  return HEARTBEAT_WINDOWS.some(([start, end]) => hour >= start && hour <= end);
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

  const baseMsg = `${prices.source}: BG ${ratios.bg} | BR ${ratios.br} | GR ${ratios.gr}`;

  // =============================
  // HEARTBEAT
  // =============================
  if (isHeartbeatTime()) {
    await sendTelegram(baseMsg);
  }

  // =============================
  // BOUNDARY ALERTS (STATELESS)
  // =============================
  if (ratios.bg !== null && (ratios.bg < BG_LOWER || ratios.bg > BG_UPPER)) {
    await sendTelegram(`${baseMsg} (BG)`);
  }

  if (ratios.br < BR_LOWER || ratios.br > BR_UPPER) {
    await sendTelegram(`${baseMsg} (BR)`);
  }

  if (ratios.gr !== null && (ratios.gr < GR_LOWER || ratios.gr > GR_UPPER)) {
    await sendTelegram(`${baseMsg} (GR)`);
  }
}

main();
