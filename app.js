const DEFAULT_COIN = "BTC";
const QUOTE = "PHP";

const COIN_KEY = "crypto_php_coin_v1";
const ALERT_KEY_PREFIX = "crypto_php_price_alert_v3_";

const ACTIVE_FALLBACK_MS = 15000;
const HIDDEN_FALLBACK_MS = 60000;
const ACTIVE_STALE_MS = 20000;
const HIDDEN_STALE_MS = 60000;
const REST_TIMEOUT_MS = 10000;
const MAX_RECONNECT_MS = 30000;

const coinFormEl = document.getElementById("coinForm");
const coinInputEl = document.getElementById("coinInput");
const pairLabelEl = document.getElementById("pairLabel");
const rangeEl = document.getElementById("range");

const timeEl = document.getElementById("time");
const priceEl = document.getElementById("price");
const alertStatusEl = document.getElementById("alertStatus");
const alertPanelEl = document.getElementById("alertPanel");
const panelTitleEl = document.getElementById("panelTitle");
const aboveInputEl = document.getElementById("aboveInput");
const belowInputEl = document.getElementById("belowInput");
const repeatInputEl = document.getElementById("repeatInput");
const dotEl = document.getElementById("dot");

const refreshBtn = document.getElementById("refreshBtn");
const alertBtn = document.getElementById("alertBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const saveAlertBtn = document.getElementById("saveAlertBtn");
const clearAlertBtn = document.getElementById("clearAlertBtn");
const closeAlertBtn = document.getElementById("closeAlertBtn");

let coin = DEFAULT_COIN;
let symbol = `${coin}${QUOTE}`;
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
