# X Media Downloader — Full Stack

```
[Chrome Extension]
       ↓  (POST /extract?url=…)
[Railway FastAPI Backend]
       ↓
[yt-dlp resolves media]
       ↓
[Returns direct_url]
       ↓
[chrome.downloads.download()]
```

---

## Part 1 — Deploy Backend to Railway

### Prerequisites
- Railway account at railway.app
- Git installed locally

### Steps

**1. Create a new Railway project**
```bash
# Install Railway CLI (optional but fast)
npm install -g @railway/cli
railway login
```

**2. Push the backend**
```bash
cd backend/
git init
git add .
git commit -m "initial deploy"

railway init          # creates a new project
railway up            # deploys using nixpacks.toml (Python 3.11 + ffmpeg)
```

Or use the Railway dashboard:
1. Go to railway.app → New Project → Deploy from GitHub repo
2. Point it at the `backend/` folder
3. Railway auto-detects `nixpacks.toml` — no extra config needed

**3. Set environment variables (Railway dashboard → Variables)**
```
PORT=8000
```
That's it. Railway injects `$PORT` automatically.

**4. Get your public URL**
Railway will assign a URL like:
```
https://xscraper-production-xxxx.railway.app
```
Copy this — you'll paste it into the Chrome extension settings.

**5. (Optional) Add cookies.txt for authenticated scraping**

In Railway dashboard → your service → "Files" tab, upload `cookies.txt`
to `/app/cookies.txt`. The backend checks this path automatically.

To generate `cookies.txt`:
1. Install "Get cookies.txt LOCALLY" Chrome extension
2. Log into x.com
3. Click extension → Export → Save as `cookies.txt`

### Verify deployment
```bash
curl https://YOUR-APP.railway.app/health
# → {"status":"healthy"}

curl "https://YOUR-APP.railway.app/extract?url=https://x.com/user/status/123456"
# → {"success":true,"tweet_url":"…","media":[…]}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/extract?url=&quality=&fmt=` | Extract media URLs |
| GET | `/formats?url=` | List all available formats |
| GET | `/proxy-stream?url=&filename=` | Proxy media stream (CORS bypass) |

**Quality options:** `best` (default), `1080p`, `720p`, `480p`, `audio`
**Format options:** `mp4` (default), `mkv`, `webm`

Interactive docs: `https://YOUR-APP.railway.app/docs`

---

## Part 2 — Install Chrome Extension

### Load unpacked (development)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The X Media Downloader icon appears in your toolbar

### Configure the extension

1. Click the extension icon → **Settings** tab
2. Paste your Railway URL: `https://YOUR-APP.railway.app`
3. The health dot turns **green** when connected
4. Click **Save settings**

### Usage — 3 ways to download

**Method 1: Popup**
1. Navigate to any X post with video/image
2. Click the extension icon
3. URL is auto-detected — click **Download media**

**Method 2: Injected button (on-page)**
- A **Download** button appears directly in the tweet action bar
- Works on timeline, profile page, and single-tweet view
- Click it — file starts downloading immediately

**Method 3: Right-click**
- Right-click any X post page or link
- Select **Download X media**

---

## Part 3 — Proxy Mode

If direct CDN URLs fail (CORS, geo-blocks), enable **Proxy mode** in Settings.

In proxy mode the flow is:
```
Extension → /proxy-stream?url=<cdn_url> → Railway → CDN → Extension
```
Railway fetches and pipes the bytes. Slightly slower but always works.

---

## Project Structure

```
xscraper/
├── backend/
│   ├── main.py            ← FastAPI app (all endpoints)
│   ├── requirements.txt   ← Python dependencies
│   ├── nixpacks.toml      ← Railway build config (Python 3.11 + ffmpeg)
│   ├── railway.toml       ← Railway deploy manifest
│   ├── Dockerfile         ← Alternative deploy via Docker
│   ├── Procfile           ← Fallback start command
│   └── .gitignore
└── extension/
    ├── manifest.json      ← Chrome MV3 manifest
    ├── background.js      ← Service worker (API calls, downloads)
    ├── popup.html         ← Extension popup UI
    ├── popup.js           ← Popup logic
    ├── content.js         ← Injects Download buttons on x.com
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## Updating yt-dlp

X frequently changes their API. If downloads break, update yt-dlp:

```bash
# In Railway: add a deploy hook, or just re-deploy with updated requirements.txt
# requirements.txt — change version to latest:
yt-dlp==2024.XX.XX
```

Or pin to latest always:
```
yt-dlp @ git+https://github.com/yt-dlp/yt-dlp.git
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Health dot red | Check Railway URL in Settings — no trailing slash |
| "No media found" | Enable proxy mode; tweet may need auth (add cookies.txt) |
| Download fails | Try proxy mode on in Settings |
| Button not appearing on x.com | Reload the page after installing extension |
| Railway deploy fails | Check nixpacks.toml — ensure ffmpeg is listed |
