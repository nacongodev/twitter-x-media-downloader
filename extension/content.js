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
    if (shouldScan) scanAndInject();
  });

  observer.observe(document.body, {
    childList: true,
    subtree:   true,
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

injectStyles();
scanAndInject();
startObserver();
