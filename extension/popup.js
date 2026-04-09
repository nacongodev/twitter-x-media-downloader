/**
 * popup.js — X Media Downloader popup logic
 * Communicates with background.js via chrome.runtime.sendMessage.
 */

const TWEET_RE = /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^/]+\/status\/\d+/;

// ── Elements ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const urlInput     = $("url-input");
const btnDownload  = $("btn-download");
const btnLabel     = $("btn-label");
const spinner      = $("spinner");
const resultBox    = $("result-box");
const autoDetect   = $("auto-detect");
const autoLabel    = $("auto-detect-label");
const btnUsePage   = $("btn-use-page");
const statusDot    = $("status-dot");
const selQuality   = $("sel-quality");
const selFormat    = $("sel-format");
const dlList       = $("dl-list");

// Settings
const apiUrlInput  = $("api-url-input");
const sQuality     = $("s-quality");
const sFormat      = $("s-format");
const sProxy       = $("s-proxy");
const btnSave      = $("btn-save");
const saveMsg      = $("save-msg");
const healthDot    = $("health-dot");
const healthLabel  = $("health-label");


// ── Tab switching ───────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.tab;
    ["download", "history", "settings"].forEach((t) => {
      $(`tab-${t}`).style.display = t === target ? "block" : "none";
    });
    if (target === "history") renderHistory();
    if (target === "settings") loadSettings();
  });
});


// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  // Load saved quality/format defaults
  const settings = await msg({ type: "GET_SETTINGS" });
  selQuality.value = settings.quality || "best";
  selFormat.value  = settings.format  || "mp4";

  // Check if current tab is a tweet
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && TWEET_RE.test(tab.url)) {
    const short = tab.url.replace(/https?:\/\/(www\.)?/, "").substring(0, 40) + "…";
    autoLabel.textContent = `Detected: ${short}`;
    autoDetect.classList.add("visible");
    btnUsePage.addEventListener("click", () => {
      urlInput.value = tab.url;
      autoDetect.classList.remove("visible");
    });
  }

  // Check backend health (async, non-blocking)
  checkBackendStatus();
}

init();


// ── Health check ────────────────────────────────────────────────────────────

async function checkBackendStatus() {
  const res = await msg({ type: "HEALTH_CHECK" });
  if (res.online) {
    statusDot.className = "status-dot online";
    statusDot.title = "Backend online";
  } else {
    statusDot.className = "status-dot offline";
    statusDot.title = "Backend offline — check settings";
  }
}


// ── Paste ────────────────────────────────────────────────────────────────────

$("btn-paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (TWEET_RE.test(text)) {
      urlInput.value = text;
      showResult("URL pasted from clipboard", "success");
      setTimeout(clearResult, 1500);
    } else {
      showResult("Clipboard doesn't contain an X post URL", "error");
    }
  } catch {
    showResult("Clipboard access denied", "error");
  }
});


// ── Download ────────────────────────────────────────────────────────────────

btnDownload.addEventListener("click", async () => {
  const url = urlInput.value.trim();

  if (!url) {
    showResult("Paste an X post URL first", "error");
    return;
  }
  if (!TWEET_RE.test(url)) {
    showResult("That doesn't look like an X post URL", "error");
    return;
  }

  setLoading(true);
  showResult("Contacting backend…", "loading");

  const result = await msg({
    type:      "DOWNLOAD",
    url,
    overrides: {
      quality: selQuality.value,
      format:  selFormat.value,
    },
  });

  setLoading(false);

  if (result.success) {
    const count = result.mediaCount || result.downloads?.length || 1;
    showResult(
      `✓ ${count} file${count > 1 ? "s" : ""} downloading — check your Downloads folder`,
      "success"
    );
    addHistory({ url, count, ts: Date.now() });
  } else {
    showResult(`✗ ${result.error || "Unknown error"}`, "error");
  }
});


// ── History ─────────────────────────────────────────────────────────────────

async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  history.unshift(entry);
  if (history.length > 30) history.pop();
  await chrome.storage.local.set({ history });
}

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get({ history: [] });

  if (!history.length) {
    dlList.innerHTML = '<div class="empty-state">No downloads yet</div>';
    return;
  }

  dlList.innerHTML = history
    .map((h) => {
      const tweetId = h.url.match(/status\/(\d+)/)?.[1] || "—";
      const time    = new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const date    = new Date(h.ts).toLocaleDateString([], { month: "short", day: "numeric" });
      return `
        <div class="dl-item">
          <div class="dl-icon">VID</div>
          <div class="dl-name" title="${h.url}">${tweetId}</div>
          <div class="dl-time">${date} ${time}</div>
        </div>`;
    })
    .join("");
}


// ── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await msg({ type: "GET_SETTINGS" });
  apiUrlInput.value = s.apiBase || "";
  sQuality.value    = s.quality || "best";
  sFormat.value     = s.format  || "mp4";
  sProxy.checked    = s.useProxy || false;
  checkApiHealth();
}

async function checkApiHealth() {
  healthDot.className  = "health-dot checking";
  healthLabel.textContent = "Checking…";
  const res = await msg({ type: "HEALTH_CHECK" });
  if (res.online) {
    healthDot.className     = "health-dot ok";
    healthLabel.textContent = "Online";
  } else {
    healthDot.className     = "health-dot bad";
    healthLabel.textContent = "Unreachable — check URL";
  }
}

apiUrlInput.addEventListener("change", async () => {
  // Save the URL immediately when changed so health check uses new value
  await msg({ type: "SAVE_SETTINGS", settings: { apiBase: apiUrlInput.value.trim() } });
  checkApiHealth();
});

btnSave.addEventListener("click", async () => {
  await msg({
    type: "SAVE_SETTINGS",
    settings: {
      apiBase:  apiUrlInput.value.trim(),
      quality:  sQuality.value,
      format:   sFormat.value,
      useProxy: sProxy.checked,
    },
  });
  saveMsg.textContent = "Settings saved";
  setTimeout(() => (saveMsg.textContent = ""), 2000);
  checkBackendStatus();
});


// ── UI helpers ───────────────────────────────────────────────────────────────

function setLoading(on) {
  btnDownload.disabled = on;
  btnDownload.classList.toggle("loading", on);
  btnLabel.textContent = on ? "Extracting…" : "Download media";
}

function showResult(text, type) {
  resultBox.textContent = text;
  resultBox.className   = `result-box visible ${type}`;
}

function clearResult() {
  resultBox.className = "result-box";
}


// ── Messaging helper ─────────────────────────────────────────────────────────

function msg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res);
      }
    });
  });
}
