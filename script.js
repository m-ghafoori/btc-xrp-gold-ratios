const axios = require("axios");

// =============================
// SETTINGS
// =============================

// Heartbeat windows (24h format)
const HEARTBEAT_WINDOWS = [
  [5, 7],
  [11, 13],
  [17, 19]
];

// Boundaries
const BG_LOWER = 11;
const BG_UPPER = 15;

const BR_LOWER = 44;
const BR_UPPER = 47;

const GR_LOWER = 30;
const GR_UPPER = 36;

// =============================
// API FETCH FUNCTIONS
// =============================

async function fetchFromNobitex() {
  const url = "https://api.nobitex.ir/market/stats?srcCurrency=btc,xrp&dstCurrency=usdt";
  const data = (await axios.get(url)).data;

  return {
    source: "Nobitex",
    btc: parseFloat(data.stats["btc-usdt"].bestSell),
    xrp: parseFloat(data.stats["xrp-usdt"].bestSell)
  };
}

async function fetchFromBinance() {
  const btc = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")).data.price);
  const xrp = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT")).data.price);

  return {
    source: "Binance",
    btc,
    xrp
  };
}

async function fetchFromCoingecko() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ripple&vs_currencies=usd";

  const data = (await axios.get(url)).data;

  return {
    source: "CoinGecko",
    btc: data.bitcoin.usd,
    xrp: data.ripple.usd
  };
}

async function fetchFromCoinpaprika() {
  const btc = (await axios.get("https://api.coinpaprika.com/v1/tickers/btc-bitcoin")).data.quotes.USD.price;
  const xrp = (await axios.get("https://api.coinpaprika.com/v1/tickers/xrp-xrp")).data.quotes.USD.price;

  return {
    source: "CoinPaprika",
    btc,
    xrp
  };
}

// =============================
// ALWAYS FETCH GOLD FROM COINGECKO
// =============================
async function fetchGold() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=tether-gold&vs_currencies=usd";

  const data = (await axios.get(url)).data;
  return data["tether-gold"].usd;
}

// =============================
// PRICE FETCHER WITH PRIORITY ORDER
// =============================
async function fetchPrices() {
  const apis = [
    fetchFromNobitex,
    fetchFromBinance,
    fetchFromCoingecko,
    fetchFromCoinpaprika
  ];

  for (const api of apis) {
    try {
      const result = await api();
      return result;
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
    bg: truncate(btc / gold),
    br: truncate((btc / xrp) / 1000),
    gr: truncate((gold / xrp) / 100)
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

  // Always fetch gold separately
  let gold;
  try {
    gold = await fetchGold();
  } catch (e) {
    await sendTelegram("FetchError: Gold unavailable");
    return;
  }

  const ratios = calculateRatios(prices.btc, prices.xrp, gold);

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
  if (ratios.bg < BG_LOWER || ratios.bg > BG_UPPER) {
    await sendTelegram(`${baseMsg} (BG)`);
  }

  if (ratios.br < BR_LOWER || ratios.br > BR_UPPER) {
    await sendTelegram(`${baseMsg} (BR)`);
  }

  if (ratios.gr < GR_LOWER || ratios.gr > GR_UPPER) {
    await sendTelegram(`${baseMsg} (GR)`);
  }
}

main();
