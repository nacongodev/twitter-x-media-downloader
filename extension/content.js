/**
 * content.js — X Media Downloader
 * Injects a "Download" button on every tweet that has media.
 * Runs on x.com and twitter.com.
 */

const TWEET_MEDIA_SEL  = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
const TWEET_ARTICLE    = 'article[data-testid="tweet"]';
const BTN_CLASS        = "xdl-btn";
const BTN_INJECTED_ATTR = "data-xdl-injected";

const STYLE_ID = "xdl-styles";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .xdl-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      margin-left: 6px;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 20px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.15s, transform 0.1s;
      z-index: 9999;
      vertical-align: middle;
    }
    .xdl-btn:hover  { opacity: 0.80; transform: scale(1.03); }
    .xdl-btn:active { transform: scale(0.97); }
    .xdl-btn.loading { opacity: 0.55; cursor: wait; }
    .xdl-btn.done   { background: #1a7a3a; }
    .xdl-btn.error  { background: #a32d2d; }
    @media (prefers-color-scheme: dark) {
      .xdl-btn { background: #fff; color: #000; }
      .xdl-btn.done  { background: #5dcaa5; color: #000; }
      .xdl-btn.error { background: #f09595; color: #000; }
    }
    .xdl-icon {
      width: 12px; height: 12px;
      fill: currentColor;
      flex-shrink: 0;
    }
    .xdl-modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    .xdl-modal {
      background: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      animation: slideUp 0.3s ease-out;
    }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .xdl-modal h3 {
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
      color: #000;
    }
    .xdl-modal p {
      margin: 0 0 20px 0;
      font-size: 14px;
      color: #666;
    }
    .xdl-modal-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    .xdl-modal-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .xdl-modal-btn-download {
      background: #1a7a3a;
      color: white;
    }
    .xdl-modal-btn-download:hover {
      background: #15633f;
      transform: scale(1.05);
    }
    .xdl-modal-btn-cancel {
      background: #f0f0f0;
      color: #000;
    }
    .xdl-modal-btn-cancel:hover {
      background: #e0e0e0;
    }
    @media (prefers-color-scheme: dark) {
      .xdl-modal {
        background: #1a1a1a;
        color: white;
      }
      .xdl-modal h3 {
        color: white;
      }
      .xdl-modal p {
        color: #aaa;
      }
      .xdl-modal-btn-cancel {
        background: #333;
        color: white;
      }
      .xdl-modal-btn-cancel:hover {
        background: #444;
      }
    }
  `;
  document.head.appendChild(style);
}

function getTweetUrl(article) {
  // Find the timestamp link inside the article — it points to the tweet permalink
  const timeLink = article.querySelector("a[href*='/status/'] time")?.closest("a");
  if (timeLink) return `https://x.com${timeLink.getAttribute("href")}`;

  // Fallback: scrape any status link
  const anyLink = article.querySelector("a[href*='/status/']");
  if (anyLink) return `https://x.com${anyLink.getAttribute("href").split("?")[0]}`;

  return null;
}

function hasMedia(article) {
  return !!article.querySelector(TWEET_MEDIA_SEL);
}

function createButton() {
  const btn = document.createElement("button");
  btn.className = BTN_CLASS;
  btn.title     = "Download media via X Media Downloader";
  btn.innerHTML = `
    <svg class="xdl-icon" viewBox="0 0 20 20">
      <path d="M10 2a1 1 0 011 1v9.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V3a1 1 0 011-1zM3 15a1 1 0 100 2h14a1 1 0 100-2H3z"/>
    </svg>
    Download
  `;
  return btn;
}

function injectButton(article) {
  if (article.getAttribute(BTN_INJECTED_ATTR)) return;
  if (!hasMedia(article)) return;

  const tweetUrl = getTweetUrl(article);
  if (!tweetUrl) return;

  // Find the actions bar (like, retweet, reply row)
  const actionsBar = article.querySelector('[role="group"][id]') ||
                     article.querySelector('[data-testid="reply"]')?.parentElement;
  if (!actionsBar) return;

  article.setAttribute(BTN_INJECTED_ATTR, "true");

  const btn = createButton();
  actionsBar.appendChild(btn);

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (btn.classList.contains("loading")) return;

    btn.classList.add("loading");
    btn.querySelector("span") && (btn.querySelector("span").textContent = "…");

    chrome.runtime.sendMessage(
      { type: "DOWNLOAD", url: tweetUrl },
      (res) => {
        btn.classList.remove("loading");
        if (res?.success) {
          btn.classList.add("done");
          btn.innerHTML = `
            <svg class="xdl-icon" viewBox="0 0 20 20">
              <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
            </svg>
            Done
          `;
          setTimeout(() => {
            btn.classList.remove("done");
            btn.innerHTML = `
              <svg class="xdl-icon" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v9.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V3a1 1 0 011-1zM3 15a1 1 0 100 2h14a1 1 0 100-2H3z"/>
              </svg>
              Download
            `;
          }, 4000);
        } else {
          btn.classList.add("error");
          btn.textContent = "Failed";
          setTimeout(() => {
            btn.classList.remove("error");
            btn.textContent = "Download";
          }, 3000);
        }
      }
    );
  });
}

function scanAndInject() {
  document.querySelectorAll(TWEET_ARTICLE).forEach(injectButton);
}

// ── MutationObserver: watch for new tweets loaded (infinite scroll) ─────────

function startObserver() {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length) { shouldScan = true; break; }
    }
    if (shouldScan) {
      scanAndInject();
      detectVideoPlayback();  // Detect any new videos
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree:   true,
  });
}

// ── Video Play Detection ──────────────────────────────────────────────────────

function getTweetUrlFromVideo(videoElement) {
  // Find the closest tweet article containing this video
  const article = videoElement.closest(TWEET_ARTICLE);
  if (article) return getTweetUrl(article);
  return null;
}

function showDownloadPrompt(tweetUrl, mediaTitle = "this media") {
  // Create modal overlay
  const overlay = document.createElement("div");
  overlay.className = "xdl-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "xdl-modal";
  modal.innerHTML = `
    <h3>Download Media?</h3>
    <p>A video is playing. Would you like to download ${mediaTitle}?</p>
    <div class="xdl-modal-buttons">
      <button class="xdl-modal-btn xdl-modal-btn-download" id="xdl-download-yes">Download</button>
      <button class="xdl-modal-btn xdl-modal-btn-cancel" id="xdl-download-no">Cancel</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Event listeners
  const downloadBtn = modal.querySelector("#xdl-download-yes");
  const cancelBtn = modal.querySelector("#xdl-download-no");

  const closeModal = () => overlay.remove();

  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading…";

    chrome.runtime.sendMessage(
      { type: "DOWNLOAD", url: tweetUrl },
      (res) => {
        if (res?.success) {
          downloadBtn.textContent = "✓ Downloaded";
          downloadBtn.style.background = "#1a7a3a";
          setTimeout(closeModal, 2000);
        } else {
          downloadBtn.textContent = "Failed";
          downloadBtn.style.background = "#a32d2d";
          setTimeout(closeModal, 2000);
        }
      }
    );
  });
}

function detectVideoPlayback() {
  // Watch for video/media elements that are playing
  const videos = document.querySelectorAll('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]');
  
  videos.forEach((video) => {
    // Skip if already monitoring
    if (video.getAttribute("data-xdl-monitored")) return;
    video.setAttribute("data-xdl-monitored", "true");

    // Detect play events
    const playHandler = () => {
      const tweetUrl = getTweetUrlFromVideo(video);
      if (tweetUrl) {
        showDownloadPrompt(tweetUrl, "this video");
        // Remove this listener so it doesn't spam
        video.removeEventListener("play", playHandler);
      }
    };

    // For actual <video> elements
    if (video.tagName === "VIDEO") {
      video.addEventListener("play", playHandler);
    } else {
      // For custom X video players, detect fullscreen or play button clicks
      const playButton = video.querySelector('[aria-label*="Play"], [role="button"]');
      if (playButton) {
        playButton.addEventListener("click", () => {
          setTimeout(() => {
            const tweetUrl = getTweetUrlFromVideo(video);
            if (tweetUrl) showDownloadPrompt(tweetUrl, "this video");
          }, 500);
        });
      }
    }
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

injectStyles();
scanAndInject();
detectVideoPlayback();  // Initial scan for videos
startObserver();
