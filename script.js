const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";

// -----------------------------
// API FETCH FUNCTIONS
// -----------------------------

// 1. Nobitex (FIRST PRIORITY)
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

// 2. CoinGecko
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

// 3. CoinPaprika
async function fetchFromCoinpaprika() {
  const btc = (await axios.get("https://api.coinpaprika.com/v1/tickers/btc-bitcoin")).data.quotes.USD.price;
  const xrp = (await axios.get("https://api.coinpaprika.com/v1/tickers/xrp-xrp")).data.quotes.USD.price;

  return {
    source: "CoinPaprika",
    btc: btc,
    xrp: xrp,
    gold: null
  };
}

// 4. Binance
async function fetchFromBinance() {
  const btc = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")).data.price);
  const xrp = parseFloat((await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT")).data.price);

  return {
    source: "Binance",
    btc: btc,
    xrp: xrp,
    gold: null
  };
}

// -----------------------------
// PRICE FETCHER WITH PRIORITY ORDER
// -----------------------------
async function fetchPrices() {
  const apis = [
    fetchFromNobitex,     // Try Nobitex FIRST
    fetchFromCoingecko,   // Then CoinGecko
    fetchFromCoinpaprika, // Then CoinPaprika
    fetchFromBinance      // Then Binance
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
// MAIN LOGIC
// -----------------------------
async function main() {
  const prices = await fetchPrices();
  const ratios = calculateRatios(prices.btc, prices.xrp, prices.gold);

  const prev = loadState();

  // Detect changes
  if (!prev || prev.bg !== ratios.bg || prev.br !== ratios.br || prev.gr !== ratios.gr) {
    const msg =
      `${prices.source} | ` +
      `B/G: ${ratios.bg} | ` +
      `B/R: ${ratios.br} | ` +
      `G/R: ${ratios.gr}`;

    await sendTelegram(msg);
    saveState(ratios);
  }
}

main();
