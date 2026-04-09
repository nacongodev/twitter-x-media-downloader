/**
 * background.js — Service Worker
 * Handles messages from popup and content script.
 * Makes API calls to Railway backend, triggers chrome.downloads.
 */

const DEFAULT_API = "https://twitter-x-media-downloader-production.up.railway.app";  // replaced by user in settings

// ── Storage helpers ────────────────────────────────────────────────────────

async function getSettings() {
  const defaults = {
    apiBase:  DEFAULT_API,
    quality:  "best",
    format:   "mp4",
    useProxy: false,
  };
  const stored = await chrome.storage.sync.get(defaults);
  return { ...defaults, ...stored };
}


// ── Core: Extract + Download ───────────────────────────────────────────────

async function extractAndDownload(tweetUrl, overrides = {}) {
  const settings = await getSettings();
  const quality  = overrides.quality  || settings.quality;
  const fmt      = overrides.format   || settings.format;
  const apiBase  = settings.apiBase.replace(/\/$/, "");

  // 1. Call /extract on Railway
  const extractUrl = `${apiBase}/extract?url=${encodeURIComponent(tweetUrl)}&quality=${quality}&fmt=${fmt}`;

  let data;
  try {
    const res = await fetch(extractUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    data = await res.json();
  } catch (e) {
    return { success: false, error: `Backend error: ${e.message}` };
  }

  if (!data.success || !data.media?.length) {
    return { success: false, error: data.error || "No media found" };
  }

  // 2. Trigger download for each media item
  const downloads = [];
  for (const item of data.media) {
    const filename = sanitiseFilename(`${item.title}.${item.ext}`);

    let downloadUrl = item.direct_url;

    // Auto-detect if URL is m3u8 (HLS playlist) - these MUST go through proxy-stream
    const isM3U8 = item.direct_url.includes(".m3u8");
    
    // If proxy mode enabled OR if it's an m3u8 URL, route through /proxy-stream
    if (settings.useProxy || isM3U8) {
      downloadUrl = `${apiBase}/proxy-stream?url=${encodeURIComponent(item.direct_url)}&filename=${encodeURIComponent(filename)}`;
    }

    try {
      const dlId = await chrome.downloads.download({
        url:      downloadUrl,
        filename: `XMedia/${filename}`,
        saveAs:   false,
      });
      downloads.push({ dlId, filename, title: item.title });
      notifyDownloadStart(item.title, dlId);
    } catch (e) {
      downloads.push({ error: e.message, filename });
    }
  }

  return { success: true, downloads, mediaCount: data.media.length };
}


// ── Formats query ──────────────────────────────────────────────────────────

async function getFormats(tweetUrl) {
  const settings = await getSettings();
  const apiBase  = settings.apiBase.replace(/\/$/, "");
  const res = await fetch(
    `${apiBase}/formats?url=${encodeURIComponent(tweetUrl)}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}


// ── Health check ───────────────────────────────────────────────────────────

async function checkHealth() {
  const settings = await getSettings();
  const apiBase  = settings.apiBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${apiBase}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}


// ── Notification helpers ───────────────────────────────────────────────────

function notifyDownloadStart(title, dlId) {
  chrome.notifications.create(`dl-${dlId}`, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "Download started",
    message: title,
  });
}

function notifyDownloadComplete(filename) {
  chrome.notifications.create(`done-${Date.now()}`, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "Download complete",
    message: filename,
  });
}

function notifyError(message) {
  chrome.notifications.create(`err-${Date.now()}`, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "Download failed",
    message: message,
  });
}


// ── Download event listeners ───────────────────────────────────────────────

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") {
    notifyDownloadComplete(delta.filename?.current || "file");
  }
  if (delta.error?.current) {
    notifyError(`Download error: ${delta.error.current}`);
  }
});

// ── Message handler for content script ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DOWNLOAD") {
    extractAndDownload(message.url)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;  // async response
  }
  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }
  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.sync.set(message.settings, () => sendResponse({ saved: true }));
    return true;
  }
  if (message.type === "HEALTH_CHECK") {
    checkHealth().then(online => sendResponse({ online }));
    return true;
  }
});


// ── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case "DOWNLOAD": {
        const result = await extractAndDownload(msg.url, msg.overrides || {});
        sendResponse(result);
        break;
      }

      case "GET_FORMATS": {
        try {
          const result = await getFormats(msg.url);
          sendResponse({ success: true, ...result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "HEALTH_CHECK": {
        const ok = await checkHealth();
        sendResponse({ online: ok });
        break;
      }

      case "GET_SETTINGS": {
        const s = await getSettings();
        sendResponse(s);
        break;
      }

      case "SAVE_SETTINGS": {
        await chrome.storage.sync.set(msg.settings);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ error: "Unknown message type" });
    }
  })();
  return true; // keep channel open for async response
});


// ── Context menu (right-click on X pages) ─────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id:       "xdl-download",
    title:    "Download X media",
    contexts: ["link", "page"],
    documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
  });
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "xdl-download") return;
  const url = info.linkUrl || tab?.url || "";
  if (!url.includes("/status/")) return;

  const result = await extractAndDownload(url);
  if (!result.success) notifyError(result.error);
});


// ── Helpers ────────────────────────────────────────────────────────────────

function sanitiseFilename(name) {
  // Remove emoji and unicode special characters, keep only ASCII letters, numbers, and basic symbols
  let clean = name
    // Remove emoji and special unicode characters
    .replace(/[\u00A0-\u9999<>:"/\\|?*\u2000-\u200D\uFEFF]/g, "_")
    // Remove multiple underscores
    .replace(/_+/g, "_")
    // Remove leading/trailing underscores and dots
    .replace(/^_+|_+$/g, "")
    // Remove common unwanted extensions that might be embedded
    .replace(/\.(json|unknown|tmp|temp)$/i, "")
    .substring(0, 200);
  
  return clean || "media";  // Fallback if everything got stripped
}
