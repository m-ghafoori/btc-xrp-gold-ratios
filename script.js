const axios = require("axios");
const fs = require("fs");

const STATE_FILE = "state.json";

async function fetchPrices() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ripple,tether-gold&vs_currencies=usd";
  const data = (await axios.get(url)).data;

  return {
    btc: data.bitcoin.usd,
    xrp: data.ripple.usd,
    gold: data["tether-gold"].usd
  };
}

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

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function sendTelegram(msg) {
  const bot = process.env.TELEGRAM_BOT;
  const chat = process.env.TELEGRAM_CHAT;

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;
  await axios.post(url, {
    chat_id: chat,
    text: msg
  });
}

async function main() {
  const prices = await fetchPrices();
  const ratios = calculateRatios(prices.btc, prices.xrp, prices.gold);

  const prev = loadState();

  if (!prev || prev.bg !== ratios.bg || prev.br !== ratios.br || prev.gr !== ratios.gr) {
    const msg = `B/G: ${ratios.bg}\nB/R: ${ratios.br}\nG/R: ${ratios.gr}`;
    await sendTelegram(msg);
    saveState(ratios);
  }
}

main();
