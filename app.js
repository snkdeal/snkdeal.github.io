const API = "https://api.pro.coins.ph";
const WS = "wss://wsapi.pro.coins.ph/openapi/quote/ws/v3";
const QUOTE = "PHP";

const PAIR_KEY = "crypto_php_pair_v1";
const ALERT_PREFIX = "crypto_php_alert_";

const REST_MS = 15000;
const HIDDEN_REST_MS = 60000;
const STALE_MS = 20000;
const HIDDEN_STALE_MS = 60000;
const TIMEOUT_MS = 10000;
const MAX_RECONNECT_MS = 30000;

const $ = id => document.getElementById(id);

const pairForm = $("pairForm");
const pairInput = $("pairInput");
const pairLabel = $("pairLabel");
const panelTitle = $("panelTitle");
const timeEl = $("time");
const priceEl = $("price");
const rangeEl = $("range");
const alertStatus = $("alertStatus");
const alertPanel = $("alertPanel");
const aboveInput = $("aboveInput");
const belowInput = $("belowInput");
const repeatInput = $("repeatInput");
const dot = $("dot");

let pair = "BTCPHP";
let base = "BTC";

let socket = null;
let reconnectTimer = null;
let fallbackTimer = null;
let timeTimer = null;
let aborter = null;

let reconnects = 0;
let lastUpdate = 0;
let manualClose = false;
let destroyed = false;

let currentPrice = null;
let previousPrice = null;
let shownPrice = "";
let shownRange = "";
let dotState = "";

let alertConfig = blankAlert();

function blankAlert() {
  return {
    above: null,
    below: null,
    repeat: false,
    aboveTriggered: false,
    belowTriggered: false
  };
}

function pairFromInput(value) {
  const clean = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!clean) return "BTCPHP";
  return clean.endsWith(QUOTE) ? clean : `${clean}${QUOTE}`;
}

function baseFromPair(value) {
  return String(value || "BTCPHP").replace(new RegExp(`${QUOTE}$`), "") || "BTC";
}

function setDot(state) {
  if (dotState === state) return;
  dotState = state;
  dot.className = `dot ${state}`;
}

function updateTime() {
  timeEl.textContent = new Date().toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).toLowerCase();
}

function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";

  if (Math.abs(n) >= 1000000) {
    return `${Number((n / 1000000).toFixed(2))}m`;
  }

  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  return n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function normalize(payload) {
  let data = payload?.data || payload;

  if (Array.isArray(data)) {
    data = data.find(item =>
      String(item.symbol || item.s || "").toUpperCase() === pair
    );
  }

  if (!data || typeof data !== "object") return null;

  return {
    symbol: String(data.symbol || data.s || pair).toUpperCase(),
    last: data.lastPrice ?? data.c,
    high: data.highPrice ?? data.h,
    low: data.lowPrice ?? data.l
  };
}

function alertKey() {
  return `${ALERT_PREFIX}${pair}`;
}

function loadAlert() {
  alertConfig = blankAlert();

  try {
    const saved = JSON.parse(localStorage.getItem(alertKey()));
    if (!saved || typeof saved !== "object") return;

    alertConfig.above = Number.isFinite(Number(saved.above))
      ? Number(saved.above)
      : null;

    alertConfig.below = Number.isFinite(Number(saved.below))
      ? Number(saved.below)
      : null;

    alertConfig.repeat = Boolean(saved.repeat);
    alertConfig.aboveTriggered = Boolean(saved.aboveTriggered);
    alertConfig.belowTriggered = Boolean(saved.belowTriggered);
  } catch (_) {}
}

function saveAlertState() {
  try {
    localStorage.setItem(alertKey(), JSON.stringify(alertConfig));
  } catch (_) {}
}

function syncAlertInputs() {
  aboveInput.value = alertConfig.above ?? "";
  belowInput.value = alertConfig.below ?? "";
  repeatInput.checked = alertConfig.repeat;
}

function renderAlertStatus(message, triggered = false) {
  if (message) {
    alertStatus.textContent = message;
    alertStatus.classList.toggle("triggered", triggered);
    return;
  }

  const parts = [];

  if (alertConfig.above !== null) parts.push(`above ${compact(alertConfig.above)}`);
  if (alertConfig.below !== null) parts.push(`below ${compact(alertConfig.below)}`);
  if (parts.length && alertConfig.repeat) parts.push("repeat");

  alertStatus.textContent = parts.length ? `Alert: ${parts.join(" / ")}` : "";
  alertStatus.classList.remove("triggered");
}

function notify(message) {
  renderAlertStatus(message, true);

  if ("vibrate" in navigator) {
    navigator.vibrate([250, 120, 250]);
  }

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`${base}/${QUOTE} Alert`, { body: message });
  }
}

function checkAlert(price, force = false) {
  if (!Number.isFinite(price)) return;

  const prev = Number.isFinite(previousPrice) ? previousPrice : null;

  if (alertConfig.above !== null) {
    const crossed = force
      ? price >= alertConfig.above
      : prev === null
        ? price >= alertConfig.above
        : prev < alertConfig.above && price >= alertConfig.above;

    if (alertConfig.repeat && price < alertConfig.above) {
      alertConfig.aboveTriggered = false;
    }

    if (!alertConfig.aboveTriggered && crossed) {
      alertConfig.aboveTriggered = true;
      if (!alertConfig.repeat) saveAlertState();
      notify(`${base}/${QUOTE} went above ${compact(alertConfig.above)}`);
    }
  }

  if (alertConfig.below !== null) {
    const crossed = force
      ? price <= alertConfig.below
      : prev === null
        ? price <= alertConfig.below
        : prev > alertConfig.below && price <= alertConfig.below;

    if (alertConfig.repeat && price > alertConfig.below) {
      alertConfig.belowTriggered = false;
    }

    if (!alertConfig.belowTriggered && crossed) {
      alertConfig.belowTriggered = true;
      if (!alertConfig.repeat) saveAlertState();
      notify(`${base}/${QUOTE} went below ${compact(alertConfig.below)}`);
    }
  }
}

function render(payload, source) {
  const data = normalize(payload);
  if (!data) return;

  const price = Number(data.last);
  if (!Number.isFinite(price)) return;

  const nextPrice = compact(price);

  if (nextPrice !== shownPrice) {
    shownPrice = nextPrice;
    priceEl.textContent = nextPrice;
  }

  const high = Number(data.high);
  const low = Number(data.low);

  if (Number.isFinite(high) && Number.isFinite(low)) {
    const nextRange = `H ${compact(high)} · L ${compact(low)}`;

    if (nextRange !== shownRange) {
      shownRange = nextRange;
      rangeEl.textContent = nextRange;
    }
  }

  currentPrice = price;
  checkAlert(price);
  previousPrice = price;
  lastUpdate = Date.now();

  setDot(source === "ws" ? "live" : "warn");
}

function resetDisplay() {
  currentPrice = null;
  previousPrice = null;
  shownPrice = "";
  shownRange = "";
  lastUpdate = 0;

  priceEl.textContent = "---";
  rangeEl.textContent = "";
}

function applyPair(nextPair) {
  pair = pairFromInput(nextPair);
  base = baseFromPair(pair);

  pairInput.value = base;
  pairLabel.textContent = `${base}/${QUOTE}`;
  panelTitle.textContent = `${base}/${QUOTE} Price Alert`;
  document.title = `${base}/${QUOTE}`;

  try {
    localStorage.setItem(PAIR_KEY, pair);
  } catch (_) {}

  resetDisplay();
  loadAlert();
  syncAlertInputs();
  renderAlertStatus();
}

function abortRest() {
  if (aborter) {
    aborter.abort();
    aborter = null;
  }
}

async function fetchRest() {
  abortRest();

  const controller = new AbortController();
  aborter = controller;

  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${API}/openapi/quote/v1/ticker/24hr?symbol=${pair}&_=${Date.now()}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`REST ${response.status}`);
    }

    const payload = await response.json();
    render(payload, "rest");
  } finally {
    clearTimeout(timer);

    if (aborter === controller) {
      aborter = null;
    }
  }
}

function closeSocket() {
  if (!socket) return;

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  try {
    socket.close();
  } catch (_) {}

  socket = null;
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function reconnectDelay() {
  const baseDelay = Math.min(
    MAX_RECONNECT_MS,
    1000 * Math.pow(2, Math.min(reconnects, 5))
  );

  return baseDelay + Math.floor(Math.random() * 1000);
}

function connectSocket() {
  if (destroyed) return;

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearReconnect();
  closeSocket();

  manualClose = false;
  setDot("warn");

  try {
    socket = new WebSocket(`${WS}/${pair.toLowerCase()}@ticker`);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnects = 0;
    setDot("live");
  };

  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.pong || payload.result === null) {
        return;
      }

      render(payload, "ws");
    } catch (_) {}
  };

  socket.onerror = () => {
    setDot("warn");
  };

  socket.onclose = () => {
    socket = null;

    if (!manualClose && !destroyed) {
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  if (destroyed) return;

  clearReconnect();
  reconnects += 1;
  setDot("dead");

  reconnectTimer = setTimeout(connectSocket, reconnectDelay());
}

async function refresh() {
  manualClose = true;
  reconnects = 0;

  clearReconnect();
  closeSocket();
  abortRest();

  try {
    await fetchRest();
  } catch (error) {
    console.error(error);
    setDot("dead");
  }

  connectSocket();
}

function scheduleFallback() {
  clearTimeout(fallbackTimer);

  if (destroyed) return;

  const hidden = document.visibilityState === "hidden";
  const interval = hidden ? HIDDEN_REST_MS : REST_MS;
  const staleLimit = hidden ? HIDDEN_STALE_MS : STALE_MS;

  fallbackTimer = setTimeout(async () => {
    if (Date.now() - lastUpdate > staleLimit) {
      try {
        await fetchRest();
      } catch (error) {
        console.error(error);
        setDot("dead");
      }
    }

    scheduleFallback();
  }, interval);
}

async function changePair(value) {
  const nextPair = pairFromInput(value);

  if (nextPair === pair) {
    pairInput.value = base;
    return;
  }

  manualClose = true;
  reconnects = 0;

  clearReconnect();
  closeSocket();
  abortRest();

  applyPair(nextPair);
  setDot("warn");

  try {
    await fetchRest();
    connectSocket();
  } catch (error) {
    console.error(error);

    resetDisplay();
    pairLabel.textContent = "NO PRICE";
    rangeEl.textContent = "Try BTC, ETH, XRP, SOL, DOGE";
    setDot("dead");
  }
}

function parsePrice(value) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function saveAlert() {
  alertConfig = {
    above: parsePrice(aboveInput.value),
    below: parsePrice(belowInput.value),
    repeat: repeatInput.checked,
    aboveTriggered: false,
    belowTriggered: false
  };

  saveAlertState();
  syncAlertInputs();
  renderAlertStatus();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) {}
  }

  if (currentPrice !== null) {
    checkAlert(currentPrice, true);
  }

  alertPanel.classList.remove("open");
}

function clearAlert() {
  alertConfig = blankAlert();

  try {
    localStorage.removeItem(alertKey());
  } catch (_) {}

  syncAlertInputs();
  renderAlertStatus();
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (_) {}
}

function bind() {
  pairForm.addEventListener("submit", event => {
    event.preventDefault();
    changePair(pairInput.value);
    pairInput.blur();
  });

  pairInput.addEventListener("input", () => {
    pairInput.value = pairInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  });

  pairInput.addEventListener("change", () => {
    changePair(pairInput.value);
  });

  $("refreshBtn").addEventListener("click", refresh);
  $("alertBtn").addEventListener("click", () => alertPanel.classList.toggle("open"));
  $("fullscreenBtn").addEventListener("click", fullscreen);
  $("saveAlertBtn").addEventListener("click", saveAlert);
  $("clearAlertBtn").addEventListener("click", clearAlert);
  $("closeAlertBtn").addEventListener("click", () => alertPanel.classList.remove("open"));

  document.addEventListener("visibilitychange", () => {
    scheduleFallback();

    if (document.visibilityState === "visible") {
      updateTime();
      fetchRest().catch(error => {
        console.error(error);
        setDot("warn");
      });
      connectSocket();
    }
  });

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    manualClose = true;

    clearReconnect();
    closeSocket();
    abortRest();

    clearTimeout(fallbackTimer);
    clearInterval(timeTimer);
  });
}

function start() {
  bind();

  let savedPair = "BTCPHP";

  try {
    savedPair = localStorage.getItem(PAIR_KEY) || "BTCPHP";
  } catch (_) {}

  applyPair(savedPair);

  updateTime();
  timeTimer = setInterval(updateTime, 1000);

  fetchRest().catch(error => {
    console.error(error);
    setDot("warn");
  });

  scheduleFallback();
  connectSocket();
}

start();let aborter = null;

let reconnects = 0;
let lastUpdate = 0;
let manualClose = false;
let dead = false;

let currentPrice = null;
let previousPrice = null;
let shownPrice = "";
let shownRange = "";
let dotState = "";

let alertConfig = blankAlert();

function blankAlert() {
  return {
    above: null,
    below: null,
    repeat: false,
    aboveTriggered: false,
    belowTriggered: false
  };
}

function pairFromInput(value) {
  const clean = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!clean) return "BTCPHP";
  return clean.endsWith(QUOTE) ? clean : `${clean}${QUOTE}`;
}

function setDot(state) {
  if (dotState === state) return;
  dotState = state;
  dot.className = `dot ${state}`;
}

function updateTime() {
  timeEl.textContent = new Date().toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).toLowerCase();
}

function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";

  if (Math.abs(n) >= 1000000) {
    return `${Number((n / 1000000).toFixed(2))}m`;
  }

  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  return n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function normalize(payload) {
  let data = payload?.data || payload;

  if (Array.isArray(data)) {
    data = data.find(x => String(x.symbol || x.s).toUpperCase() === pair);
  }

  if (!data || typeof data !== "object") return null;

  return {
    symbol: String(data.symbol || data.s || "").toUpperCase(),
    last: data.lastPrice ?? data.c,
    high: data.highPrice ?? data.h,
    low: data.lowPrice ?? data.l
  };
}

function alertKey() {
  return `${ALERT_PREFIX}${pair}`;
}

function loadAlert() {
  alertConfig = blankAlert();

  try {
    const saved = JSON.parse(localStorage.getItem(alertKey()));
    if (!saved) return;

    alertConfig.above = Number.isFinite(Number(saved.above)) ? Number(saved.above) : null;
    alertConfig.below = Number.isFinite(Number(saved.below)) ? Number(saved.below) : null;
    alertConfig.repeat = Boolean(saved.repeat);
    alertConfig.aboveTriggered = Boolean(saved.aboveTriggered);
    alertConfig.belowTriggered = Boolean(saved.belowTriggered);
  } catch (_) {}
}

function saveAlertState() {
  try {
    localStorage.setItem(alertKey(), JSON.stringify(alertConfig));
  } catch (_) {}
}

function syncAlertInputs() {
  aboveInput.value = alertConfig.above ?? "";
  belowInput.value = alertConfig.below ?? "";
  repeatInput.checked = alertConfig.repeat;
}

function renderAlertStatus(message, triggered = false) {
  if (message) {
    alertStatus.textContent = message;
    alertStatus.classList.toggle("triggered", triggered);
    return;
  }

  const parts = [];

  if (alertConfig.above !== null) parts.push(`above ${compact(alertConfig.above)}`);
  if (alertConfig.below !== null) parts.push(`below ${compact(alertConfig.below)}`);
  if (parts.length && alertConfig.repeat) parts.push("repeat");

  alertStatus.textContent = parts.length ? `Alert: ${parts.join(" / ")}` : "";
  alertStatus.classList.remove("triggered");
}

function notify(message) {
  renderAlertStatus(message, true);

  if ("vibrate" in navigator) {
    navigator.vibrate([250, 120, 250]);
  }

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`${base}/${QUOTE} Alert`, { body: message });
  }
}

function checkAlert(price, force = false) {
  if (!Number.isFinite(price)) return;

  const prev = Number.isFinite(previousPrice) ? previousPrice : null;

  if (alertConfig.above !== null) {
    const crossed = force
      ? price >= alertConfig.above
      : prev === null
        ? price >= alertConfig.above
        : prev < alertConfig.above && price >= alertConfig.above;

    if (alertConfig.repeat && price < alertConfig.above) {
      alertConfig.aboveTriggered = false;
    }

    if (!alertConfig.aboveTriggered && crossed) {
      alertConfig.aboveTriggered = true;
      if (!alertConfig.repeat) saveAlertState();
      notify(`${base}/${QUOTE} went above ${compact(alertConfig.above)}`);
    }
  }

  if (alertConfig.below !== null) {
    const crossed = force
      ? price <= alertConfig.below
      : prev === null
        ? price <= alertConfig.below
        : prev > alertConfig.below && price <= alertConfig.below;

    if (alertConfig.repeat && price > alertConfig.below) {
      alertConfig.belowTriggered = false;
    }

    if (!alertConfig.belowTriggered && crossed) {
      alertConfig.belowTriggered = true;
      if (!alertConfig.repeat) saveAlertState();
      notify(`${base}/${QUOTE} went below ${compact(alertConfig.below)}`);
    }
  }
}

function render(payload, source) {
  const data = normalize(payload);
  if (!data || data.symbol !== pair) return;

  const price = Number(data.last);
  if (!Number.isFinite(price)) return;

  const nextPrice = compact(price);
  if (nextPrice !== shownPrice) {
    shownPrice = nextPrice;
    priceEl.textContent = nextPrice;
  }

  const high = Number(data.high);
  const low = Number(data.low);

  if (Number.isFinite(high) && Number.isFinite(low)) {
    const nextRange = `H ${compact(high)} · L ${compact(low)}`;
    if (nextRange !== shownRange) {
      shownRange = nextRange;
      rangeEl.textContent = nextRange;
    }
  }

  currentPrice = price;
  checkAlert(price);
  previousPrice = price;
  lastUpdate = Date.now();

  setDot(source === "ws" ? "live" : "warn");
}

function resetDisplay() {
  currentPrice = null;
  previousPrice = null;
  shownPrice = "";
  shownRange = "";
  lastUpdate = 0;

  priceEl.textContent = "---";
  rangeEl.textContent = "";
}

function applyPair(nextPair, nextBase) {
  pair = nextPair;
  base = nextBase || pair.replace(new RegExp(`${QUOTE}$`), "");

  pairInput.value = base;
  pairLabel.textContent = `${base}/${QUOTE}`;
  panelTitle.textContent = `${base}/${QUOTE} Price Alert`;
  document.title = `${base}/${QUOTE}`;

  try {
    localStorage.setItem(PAIR_KEY, pair);
  } catch (_) {}

  resetDisplay();
  loadAlert();
  syncAlertInputs();
  renderAlertStatus();
}

async function validatePair(nextPair) {
  const url = `${API}/openapi/v1/exchangeInfo?symbol=${encodeURIComponent(nextPair)}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) throw new Error("pair check failed");

  const data = await response.json();
  const item = data?.symbols?.find(x => x.symbol === nextPair && x.status === "TRADING");

  if (!item || item.quoteAsset !== QUOTE) {
    throw new Error("pair not available");
  }

  return item;
}

function abortRest() {
  if (aborter) {
    aborter.abort();
    aborter = null;
  }
}

async function fetchRest() {
  abortRest();

  const controller = new AbortController();
  aborter = controller;

  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${API}/openapi/quote/v1/ticker/24hr?symbol=${pair}&_=${Date.now()}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`REST ${response.status}`);

    render(await response.json(), "rest");
  } finally {
    clearTimeout(timer);
    if (aborter === controller) aborter = null;
  }
}

function closeSocket() {
  if (!socket) return;

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  try {
    socket.close();
  } catch (_) {}

  socket = null;
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function reconnectDelay() {
  const baseDelay = Math.min(
    MAX_RECONNECT_MS,
    1000 * Math.pow(2, Math.min(reconnects, 5))
  );

  return baseDelay + Math.floor(Math.random() * 1000);
}

function connectSocket() {
  if (dead || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  clearReconnect();
  closeSocket();
  manualClose = false;
  setDot("warn");

  try {
    socket = new WebSocket(`${WS}/${pair.toLowerCase()}@ticker`);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnects = 0;
    setDot("live");
  };

  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.pong || payload.result === null) return;
      render(payload, "ws");
    } catch (_) {}
  };

  socket.onerror = () => setDot("warn");

  socket.onclose = () => {
    socket = null;
    if (!manualClose && !dead) scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (dead) return;

  clearReconnect();
  reconnects += 1;
  setDot("dead");

  reconnectTimer = setTimeout(connectSocket, reconnectDelay());
}

async function refresh() {
  manualClose = true;
  reconnects = 0;

  clearReconnect();
  closeSocket();
  abortRest();

  try {
    await fetchRest();
  } catch (_) {
    setDot("dead");
  }

  connectSocket();
}

function scheduleFallback() {
  clearTimeout(fallbackTimer);
  if (dead) return;

  const hidden = document.visibilityState === "hidden";
  const interval = hidden ? HIDDEN_REST_MS : REST_MS;
  const staleLimit = hidden ? HIDDEN_STALE_MS : STALE_MS;

  fallbackTimer = setTimeout(async () => {
    if (Date.now() - lastUpdate > staleLimit) {
      try {
        await fetchRest();
      } catch (_) {
        setDot("dead");
      }
    }

    scheduleFallback();
  }, interval);
}

async function changePair(value) {
  const nextPair = pairFromInput(value);

  if (nextPair === pair) {
    pairInput.value = base;
    return;
  }

  manualClose = true;
  clearReconnect();
  closeSocket();
  abortRest();
  setDot("warn");

  try {
    const info = await validatePair(nextPair);
    applyPair(info.symbol, info.baseAsset);
    await fetchRest();
    connectSocket();
  } catch (_) {
    resetDisplay();
    pairInput.value = value.toUpperCase();
    pairLabel.textContent = "NOT LISTED";
    rangeEl.textContent = "Try BTC, ETH, XRP, or another PHP pair";
    renderAlertStatus("");
    setDot("dead");
  }
}

function parsePrice(value) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function saveAlert() {
  alertConfig = {
    above: parsePrice(aboveInput.value),
    below: parsePrice(belowInput.value),
    repeat: repeatInput.checked,
    aboveTriggered: false,
    belowTriggered: false
  };

  saveAlertState();
  syncAlertInputs();
  renderAlertStatus();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) {}
  }

  if (currentPrice !== null) {
    checkAlert(currentPrice, true);
  }

  alertPanel.classList.remove("open");
}

function clearAlert() {
  alertConfig = blankAlert();

  try {
    localStorage.removeItem(alertKey());
  } catch (_) {}

  syncAlertInputs();
  renderAlertStatus();
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (_) {}
}

function bind() {
  pairForm.addEventListener("submit", event => {
    event.preventDefault();
    changePair(pairInput.value);
    pairInput.blur();
  });

  pairInput.addEventListener("input", () => {
    pairInput.value = pairInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  pairInput.addEventListener("change", () => {
    changePair(pairInput.value);
  });

  $("refreshBtn").addEventListener("click", refresh);
  $("alertBtn").addEventListener("click", () => alertPanel.classList.toggle("open"));
  $("fullscreenBtn").addEventListener("click", fullscreen);
  $("saveAlertBtn").addEventListener("click", saveAlert);
  $("clearAlertBtn").addEventListener("click", clearAlert);
  $("closeAlertBtn").addEventListener("click", () => alertPanel.classList.remove("open"));

  document.addEventListener("visibilitychange", () => {
    scheduleFallback();

    if (document.visibilityState === "visible") {
      updateTime();
      fetchRest().catch(() => setDot("warn"));
      connectSocket();
    }
  });

  window.addEventListener("beforeunload", () => {
    dead = true;
    manualClose = true;
    clearReconnect();
    closeSocket();
    abortRest();
    clearTimeout(fallbackTimer);
    clearInterval(timeTimer);
  });
}

async function start() {
  bind();

  let saved = "BTCPHP";

  try {
    saved = localStorage.getItem(PAIR_KEY) || "BTCPHP";
  } catch (_) {}

  try {
    const info = await validatePair(saved);
    applyPair(info.symbol, info.baseAsset);
  } catch (_) {
    applyPair("BTCPHP", "BTC");
  }

  updateTime();
  timeTimer = setInterval(updateTime, 1000);

  fetchRest().catch(() => setDot("warn"));
  scheduleFallback();
  connectSocket();
}

start();let symbol = `${coin}${QUOTE}`;
let streamSymbol = symbol.toLowerCase();

let socket = null;
let reconnectTimer = null;
let fallbackTimer = null;
let timeTimer = null;
let restAbortController = null;

let reconnectAttempts = 0;
let lastUpdateAt = 0;
let manualClose = false;
let destroyed = false;

let currentPrice = null;
let previousPrice = null;
let displayedPrice = "";
let displayedRange = "";
let dotState = "";

let alertConfig = getEmptyAlertConfig();

function getWsUrl() {
  return `wss://wsapi.pro.coins.ph/openapi/quote/ws/v3/${streamSymbol}@ticker`;
}

function getRestUrl() {
  return `https://api.pro.coins.ph/openapi/quote/v1/ticker/24hr?symbol=${symbol}`;
}

function getAlertKey() {
  return `${ALERT_KEY_PREFIX}${symbol}`;
}

function getEmptyAlertConfig() {
  return {
    above: null,
    below: null,
    repeat: false,
    aboveTriggered: false,
    belowTriggered: false
  };
}

function sanitizeCoin(value) {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return cleaned || DEFAULT_COIN;
}

function setCoin(nextCoin) {
  coin = sanitizeCoin(nextCoin);
  symbol = `${coin}${QUOTE}`;
  streamSymbol = symbol.toLowerCase();

  try {
    localStorage.setItem(COIN_KEY, coin);
  } catch (_) {}

  coinInputEl.value = coin;
  pairLabelEl.textContent = `${coin}/${QUOTE}`;
  panelTitleEl.textContent = `${coin}/${QUOTE} Price Alert`;
  document.title = `${coin}/${QUOTE}`;

  currentPrice = null;
  previousPrice = null;
  displayedPrice = "";
  displayedRange = "";
  lastUpdateAt = 0;

  priceEl.textContent = "---";
  rangeEl.textContent = "24h H -- / L --";

  loadAlert();
  updateAlertInputs();
  updateAlertStatus();
}

function updateTime() {
  const now = new Date();

  timeEl.textContent = now.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).toLowerCase();
}

function setDot(state) {
  if (dotState === state) {
    return;
  }

  dotState = state;
  dotEl.className = `dot ${state}`;
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  if (Math.abs(number) >= 1000000) {
    const compact = number / 1000000;
    return `${Number(compact.toFixed(2)).toString()}m`;
  }

  if (Math.abs(number) >= 1000) {
    return number.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  return number.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function normalize(payload) {
  let data = payload && payload.data ? payload.data : payload;

  if (Array.isArray(data)) {
    data = data.find(item =>
      String(item.symbol || item.s || "").toUpperCase() === symbol
    );
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    last: data.c ?? data.lastPrice,
    high: data.h ?? data.highPrice,
    low: data.l ?? data.lowPrice
  };
}

function parseOptionalPrice(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return null;
  }

  const number = Number(trimmed);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number;
}

function loadSavedCoin() {
  try {
    return sanitizeCoin(localStorage.getItem(COIN_KEY));
  } catch (_) {
    return DEFAULT_COIN;
  }
}

function loadAlert() {
  alertConfig = getEmptyAlertConfig();

  try {
    const saved = JSON.parse(localStorage.getItem(getAlertKey()));

    if (!saved || typeof saved !== "object") {
      return;
    }

    alertConfig.above = Number.isFinite(Number(saved.above))
      ? Number(saved.above)
      : null;

    alertConfig.below = Number.isFinite(Number(saved.below))
      ? Number(saved.below)
      : null;

    alertConfig.repeat = Boolean(saved.repeat);
    alertConfig.aboveTriggered = Boolean(saved.aboveTriggered);
    alertConfig.belowTriggered = Boolean(saved.belowTriggered);
  } catch (_) {}
}

function persistAlert() {
  try {
    localStorage.setItem(getAlertKey(), JSON.stringify(alertConfig));
  } catch (_) {}
}

function updateAlertInputs() {
  aboveInputEl.value = alertConfig.above === null ? "" : alertConfig.above;
  belowInputEl.value = alertConfig.below === null ? "" : alertConfig.below;
  repeatInputEl.checked = Boolean(alertConfig.repeat);
}

function updateAlertStatus(message, triggered) {
  if (message) {
    alertStatusEl.textContent = message;
    alertStatusEl.classList.toggle("triggered", Boolean(triggered));
    return;
  }

  const parts = [];

  if (alertConfig.above !== null) {
    parts.push(`above ${formatPrice(alertConfig.above)}`);
  }

  if (alertConfig.below !== null) {
    parts.push(`below ${formatPrice(alertConfig.below)}`);
  }

  if (parts.length && alertConfig.repeat) {
    parts.push("repeat on");
  }

  alertStatusEl.textContent = parts.length
    ? `Alert set: ${parts.join(" / ")}`
    : "";

  alertStatusEl.classList.remove("triggered");
}

function notifyAlert(message) {
  updateAlertStatus(message, true);

  if ("vibrate" in navigator) {
    navigator.vibrate([250, 120, 250]);
  }

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`${coin}/${QUOTE} Alert`, {
      body: message
    });
  }
}

function maybePersistTriggeredState() {
  if (!alertConfig.repeat) {
    persistAlert();
  }
}

function checkAlert(price, force = false) {
  if (!Number.isFinite(price)) {
    return;
  }

  const prev = Number.isFinite(previousPrice) ? previousPrice : null;

  if (alertConfig.above !== null) {
    const crossedAbove = force
      ? price >= alertConfig.above
      : prev === null
        ? price >= alertConfig.above
        : prev < alertConfig.above && price >= alertConfig.above;

    if (alertConfig.repeat && price < alertConfig.above) {
      alertConfig.aboveTriggered = false;
    }

    if (!alertConfig.aboveTriggered && crossedAbove) {
      alertConfig.aboveTriggered = true;
      maybePersistTriggeredState();
      notifyAlert(`${coin}/${QUOTE} went above ${formatPrice(alertConfig.above)}`);
    }
  }

  if (alertConfig.below !== null) {
    const crossedBelow = force
      ? price <= alertConfig.below
      : prev === null
        ? price <= alertConfig.below
        : prev > alertConfig.below && price <= alertConfig.below;

    if (alertConfig.repeat && price > alertConfig.below) {
      alertConfig.belowTriggered = false;
    }

    if (!alertConfig.belowTriggered && crossedBelow) {
      alertConfig.belowTriggered = true;
      maybePersistTriggeredState();
      notifyAlert(`${coin}/${QUOTE} went below ${formatPrice(alertConfig.below)}`);
    }
  }
}

function render(payload, source) {
  const data = normalize(payload);

  if (!data) {
    return;
  }

  const price = Number(data.last);

  if (!Number.isFinite(price)) {
    return;
  }

  const formatted = formatPrice(price);

  if (formatted !== displayedPrice) {
    displayedPrice = formatted;
    priceEl.textContent = formatted;
  }

  const high = Number(data.high);
  const low = Number(data.low);

  if (Number.isFinite(high) && Number.isFinite(low)) {
    const rangeText = `24h H ${formatPrice(high)} / L ${formatPrice(low)}`;

    if (rangeText !== displayedRange) {
      displayedRange = rangeText;
      rangeEl.textContent = rangeText;
    }
  }

  currentPrice = price;

  checkAlert(price);

  previousPrice = price;
  lastUpdateAt = Date.now();

  setDot(source === "ws" ? "live" : "warn");
}

function abortRest() {
  if (restAbortController) {
    restAbortController.abort();
    restAbortController = null;
  }
}

async function fetchRest() {
  abortRest();

  const controller = new AbortController();
  restAbortController = controller;

  const timeout = setTimeout(() => {
    controller.abort();
  }, REST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getRestUrl()}&_=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`REST ${response.status}`);
    }

    const payload = await response.json();
    render(payload, "rest");
  } finally {
    clearTimeout(timeout);

    if (restAbortController === controller) {
      restAbortController = null;
    }
  }
}

function clearSocketOnly() {
  if (!socket) {
    return;
  }

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  try {
    socket.close();
  } catch (_) {}

  socket = null;
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function reconnectDelay() {
  const base = Math.min(
    MAX_RECONNECT_MS,
    1000 * Math.pow(2, Math.min(reconnectAttempts, 5))
  );

  const jitter = Math.floor(Math.random() * 1000);

  return base + jitter;
}

function connectSocket() {
  if (destroyed) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearReconnect();
  clearSocketOnly();

  manualClose = false;
  setDot("warn");

  try {
    socket = new WebSocket(getWsUrl());
  } catch (_) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
    setDot("live");
  };

  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.pong || payload.result === null) {
        return;
      }

      render(payload, "ws");
    } catch (_) {}
  };

  socket.onerror = () => {
    setDot("warn");
  };

  socket.onclose = () => {
    socket = null;

    if (!manualClose && !destroyed) {
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  if (destroyed) {
    return;
  }

  clearReconnect();

  reconnectAttempts += 1;
  setDot("dead");

  reconnectTimer = setTimeout(() => {
    connectSocket();
  }, reconnectDelay());
}

async function manualRefresh() {
  manualClose = true;
  reconnectAttempts = 0;

  clearReconnect();
  clearSocketOnly();
  abortRest();

  try {
    await fetchRest();
  } catch (_) {
    setDot("dead");
  }

  connectSocket();
}

function scheduleFallback() {
  clearTimeout(fallbackTimer);

  if (destroyed) {
    return;
  }

  const hidden = document.visibilityState === "hidden";
  const interval = hidden ? HIDDEN_FALLBACK_MS : ACTIVE_FALLBACK_MS;
  const staleLimit = hidden ? HIDDEN_STALE_MS : ACTIVE_STALE_MS;

  fallbackTimer = setTimeout(async () => {
    const stale = Date.now() - lastUpdateAt > staleLimit;

    if (stale) {
      try {
        await fetchRest();
      } catch (_) {
        setDot("dead");
      }
    }

    scheduleFallback();
  }, interval);
}

function toggleAlertPanel() {
  alertPanelEl.classList.toggle("open");
}

async function saveAlert() {
  const above = parseOptionalPrice(aboveInputEl.value);
  const below = parseOptionalPrice(belowInputEl.value);
  const repeat = repeatInputEl.checked;

  alertConfig = {
    above,
    below,
    repeat,
    aboveTriggered: false,
    belowTriggered: false
  };

  persistAlert();
  updateAlertInputs();
  updateAlertStatus();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) {}
  }

  if (currentPrice !== null) {
    checkAlert(currentPrice, true);
  }

  alertPanelEl.classList.remove("open");
}

function clearAlert() {
  alertConfig = getEmptyAlertConfig();

  try {
    localStorage.removeItem(getAlertKey());
  } catch (_) {}

  updateAlertInputs();
  updateAlertStatus();
}

async function goFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (_) {}
}

async function changeCoin(value) {
  const nextCoin = sanitizeCoin(value);

  if (nextCoin === coin) {
    coinInputEl.value = coin;
    return;
  }

  manualClose = true;
  reconnectAttempts = 0;

  clearReconnect();
  clearSocketOnly();
  abortRest();

  setCoin(nextCoin);
  setDot("warn");

  try {
    await fetchRest();
  } catch (_) {
    setDot("dead");
  }

  connectSocket();
}

function bindEvents() {
  coinFormEl.addEventListener("submit", event => {
    event.preventDefault();
    changeCoin(coinInputEl.value);
    coinInputEl.blur();
  });

  coinInputEl.addEventListener("change", () => {
    changeCoin(coinInputEl.value);
  });

  coinInputEl.addEventListener("input", () => {
    coinInputEl.value = coinInputEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  refreshBtn.addEventListener("click", manualRefresh);
  alertBtn.addEventListener("click", toggleAlertPanel);
  fullscreenBtn.addEventListener("click", goFullscreen);

  saveAlertBtn.addEventListener("click", saveAlert);
  clearAlertBtn.addEventListener("click", clearAlert);
  closeAlertBtn.addEventListener("click", toggleAlertPanel);

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    manualClose = true;

    clearReconnect();
    clearSocketOnly();
    abortRest();

    clearTimeout(fallbackTimer);
    clearInterval(timeTimer);
  });

  document.addEventListener("visibilitychange", () => {
    scheduleFallback();

    if (document.visibilityState === "visible") {
      updateTime();

      if (
        !socket ||
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        connectSocket();
      }

      fetchRest().catch(() => setDot("warn"));
    }
  });
}

function startApp() {
  bindEvents();

  setCoin(loadSavedCoin());

  updateTime();
  timeTimer = setInterval(updateTime, 1000);

  fetchRest().catch(() => setDot("warn"));
  scheduleFallback();
  connectSocket();
}

startApp();let fallbackTimer = null;
let timeTimer = null;
let restAbortController = null;

let reconnectAttempts = 0;
let lastUpdateAt = 0;
let manualClose = false;
let destroyed = false;

let currentPrice = null;
let previousPrice = null;
let displayedPrice = "";
let dotState = "";

let alertConfig = {
  above: null,
  below: null,
  repeat: false,
  aboveTriggered: false,
  belowTriggered: false
};

function updateTime() {
  const now = new Date();

  timeEl.textContent = now.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).toLowerCase();
}

function setDot(state) {
  if (dotState === state) {
    return;
  }

  dotState = state;
  dotEl.className = `dot ${state}`;
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  return number.toFixed(2);
}

function normalize(payload) {
  let data = payload && payload.data ? payload.data : payload;

  if (Array.isArray(data)) {
    data = data.find(item =>
      String(item.symbol || item.s || "").toUpperCase() === SYMBOL
    );
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    last: data.c ?? data.lastPrice
  };
}

function parseOptionalPrice(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return null;
  }

  const number = Number(trimmed);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number;
}

function loadAlert() {
  try {
    const saved = JSON.parse(localStorage.getItem(ALERT_KEY));

    if (!saved || typeof saved !== "object") {
      return;
    }

    alertConfig.above = Number.isFinite(Number(saved.above))
      ? Number(saved.above)
      : null;

    alertConfig.below = Number.isFinite(Number(saved.below))
      ? Number(saved.below)
      : null;

    alertConfig.repeat = Boolean(saved.repeat);
    alertConfig.aboveTriggered = Boolean(saved.aboveTriggered);
    alertConfig.belowTriggered = Boolean(saved.belowTriggered);
  } catch (_) {}
}

function persistAlert() {
  try {
    localStorage.setItem(ALERT_KEY, JSON.stringify(alertConfig));
  } catch (_) {}
}

function updateAlertInputs() {
  aboveInputEl.value = alertConfig.above === null ? "" : alertConfig.above;
  belowInputEl.value = alertConfig.below === null ? "" : alertConfig.below;
  repeatInputEl.checked = Boolean(alertConfig.repeat);
}

function updateAlertStatus(message, triggered) {
  if (message) {
    alertStatusEl.textContent = message;
    alertStatusEl.classList.toggle("triggered", Boolean(triggered));
    return;
  }

  const parts = [];

  if (alertConfig.above !== null) {
    parts.push(`above ${formatNumber(alertConfig.above)}`);
  }

  if (alertConfig.below !== null) {
    parts.push(`below ${formatNumber(alertConfig.below)}`);
  }

  if (parts.length && alertConfig.repeat) {
    parts.push("repeat on");
  }

  alertStatusEl.textContent = parts.length
    ? `Alert set: ${parts.join(" / ")}`
    : "";

  alertStatusEl.classList.remove("triggered");
}

function notifyAlert(message) {
  updateAlertStatus(message, true);

  if ("vibrate" in navigator) {
    navigator.vibrate([250, 120, 250]);
  }

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("BTC/PHP Alert", {
      body: message
    });
  }
}

function maybePersistTriggeredState() {
  if (!alertConfig.repeat) {
    persistAlert();
  }
}

function checkAlert(price, force = false) {
  if (!Number.isFinite(price)) {
    return;
  }

  const prev = Number.isFinite(previousPrice) ? previousPrice : null;

  if (alertConfig.above !== null) {
    const crossedAbove = force
      ? price >= alertConfig.above
      : prev === null
        ? price >= alertConfig.above
        : prev < alertConfig.above && price >= alertConfig.above;

    if (alertConfig.repeat && price < alertConfig.above) {
      alertConfig.aboveTriggered = false;
    }

    if (!alertConfig.aboveTriggered && crossedAbove) {
      alertConfig.aboveTriggered = true;
      maybePersistTriggeredState();
      notifyAlert(`BTC/PHP went above ${formatNumber(alertConfig.above)}`);
    }
  }

  if (alertConfig.below !== null) {
    const crossedBelow = force
      ? price <= alertConfig.below
      : prev === null
        ? price <= alertConfig.below
        : prev > alertConfig.below && price <= alertConfig.below;

    if (alertConfig.repeat && price > alertConfig.below) {
      alertConfig.belowTriggered = false;
    }

    if (!alertConfig.belowTriggered && crossedBelow) {
      alertConfig.belowTriggered = true;
      maybePersistTriggeredState();
      notifyAlert(`BTC/PHP went below ${formatNumber(alertConfig.below)}`);
    }
  }
}

function render(payload, source) {
  const data = normalize(payload);

  if (!data) {
    return;
  }

  const price = Number(data.last);

  if (!Number.isFinite(price)) {
    return;
  }

  const formatted = formatNumber(price);

  if (formatted !== displayedPrice) {
    displayedPrice = formatted;
    priceEl.textContent = formatted;
  }

  currentPrice = price;

  checkAlert(price);

  previousPrice = price;
  lastUpdateAt = Date.now();

  setDot(source === "ws" ? "live" : "warn");
}

function abortRest() {
  if (restAbortController) {
    restAbortController.abort();
    restAbortController = null;
  }
}

async function fetchRest() {
  abortRest();

  const controller = new AbortController();
  restAbortController = controller;

  const timeout = setTimeout(() => {
    controller.abort();
  }, REST_TIMEOUT_MS);

  try {
    const response = await fetch(`${REST_URL}&_=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`REST ${response.status}`);
    }

    const payload = await response.json();
    render(payload, "rest");
  } finally {
    clearTimeout(timeout);

    if (restAbortController === controller) {
      restAbortController = null;
    }
  }
}

function clearSocketOnly() {
  if (!socket) {
    return;
  }

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  try {
    socket.close();
  } catch (_) {}

  socket = null;
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function reconnectDelay() {
  const base = Math.min(
    MAX_RECONNECT_MS,
    1000 * Math.pow(2, Math.min(reconnectAttempts, 5))
  );

  const jitter = Math.floor(Math.random() * 1000);

  return base + jitter;
}

function connectSocket() {
  if (destroyed) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearReconnect();
  clearSocketOnly();

  manualClose = false;
  setDot("warn");

  try {
    socket = new WebSocket(WS_URL);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
    setDot("live");
  };

  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.pong || payload.result === null) {
        return;
      }

      render(payload, "ws");
    } catch (_) {}
  };

  socket.onerror = () => {
    setDot("warn");
  };

  socket.onclose = () => {
    socket = null;

    if (!manualClose && !destroyed) {
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  if (destroyed) {
    return;
  }

  clearReconnect();

  reconnectAttempts += 1;
  setDot("dead");

  reconnectTimer = setTimeout(() => {
    connectSocket();
  }, reconnectDelay());
}

async function manualRefresh() {
  manualClose = true;
  reconnectAttempts = 0;

  clearReconnect();
  clearSocketOnly();
  abortRest();

  try {
    await fetchRest();
  } catch (_) {
    setDot("dead");
  }

  connectSocket();
}

function scheduleFallback() {
  clearTimeout(fallbackTimer);

  if (destroyed) {
    return;
  }

  const hidden = document.visibilityState === "hidden";
  const interval = hidden ? HIDDEN_FALLBACK_MS : ACTIVE_FALLBACK_MS;
  const staleLimit = hidden ? HIDDEN_STALE_MS : ACTIVE_STALE_MS;

  fallbackTimer = setTimeout(async () => {
    const stale = Date.now() - lastUpdateAt > staleLimit;

    if (stale) {
      try {
        await fetchRest();
      } catch (_) {
        setDot("dead");
      }
    }

    scheduleFallback();
  }, interval);
}

function toggleAlertPanel() {
  alertPanelEl.classList.toggle("open");
}

async function saveAlert() {
  const above = parseOptionalPrice(aboveInputEl.value);
  const below = parseOptionalPrice(belowInputEl.value);
  const repeat = repeatInputEl.checked;

  alertConfig = {
    above,
    below,
    repeat,
    aboveTriggered: false,
    belowTriggered: false
  };

  persistAlert();
  updateAlertInputs();
  updateAlertStatus();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) {}
  }

  if (currentPrice !== null) {
    checkAlert(currentPrice, true);
  }

  alertPanelEl.classList.remove("open");
}

function clearAlert() {
  alertConfig = {
    above: null,
    below: null,
    repeat: false,
    aboveTriggered: false,
    belowTriggered: false
  };

  try {
    localStorage.removeItem(ALERT_KEY);
  } catch (_) {}

  updateAlertInputs();
  updateAlertStatus();
}

async function goFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (_) {}
}

function bindEvents() {
  refreshBtn.addEventListener("click", manualRefresh);
  alertBtn.addEventListener("click", toggleAlertPanel);
  fullscreenBtn.addEventListener("click", goFullscreen);

  saveAlertBtn.addEventListener("click", saveAlert);
  clearAlertBtn.addEventListener("click", clearAlert);
  closeAlertBtn.addEventListener("click", toggleAlertPanel);

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    manualClose = true;

    clearReconnect();
    clearSocketOnly();
    abortRest();

    clearTimeout(fallbackTimer);
    clearInterval(timeTimer);
  });

  document.addEventListener("visibilitychange", () => {
    scheduleFallback();

    if (document.visibilityState === "visible") {
      updateTime();

      if (
        !socket ||
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        connectSocket();
      }

      fetchRest().catch(() => setDot("warn"));
    }
  });
}

function startApp() {
  bindEvents();

  loadAlert();
  updateAlertInputs();
  updateAlertStatus();

  updateTime();
  timeTimer = setInterval(updateTime, 1000);

  fetchRest().catch(() => setDot("warn"));
  scheduleFallback();
  connectSocket();
}

startApp();
