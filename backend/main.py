"""
X Media Scraper — FastAPI Backend
Deployed on Railway. Exposes endpoints consumed by the Chrome Extension.
"""

import os
import re
import asyncio
import logging
from typing import Optional
from contextlib import asynccontextmanager

import yt_dlp
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("X Media Scraper API starting")
    yield


app = FastAPI(
    title="X Media Scraper API",
    description="Extract and stream media from X (Twitter) posts",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────

class MediaInfo(BaseModel):
    title: str
    ext: str
    filesize: Optional[int] = None
    thumbnail: Optional[str] = None
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format_id: str
    direct_url: str


class ExtractResponse(BaseModel):
    success: bool
    tweet_url: str
    media: list[MediaInfo]
    error: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

TWITTER_RE = re.compile(
    r"https?://(www\.)?(twitter\.com|x\.com)/[^/]+/status/\d+"
)

QUALITY_MAP = {
    "best":  "bestvideo+bestaudio/best",
    "1080p": "bestvideo[height<=1080]+bestaudio/best",
    "720p":  "bestvideo[height<=720]+bestaudio/best",
    "480p":  "bestvideo[height<=480]+bestaudio/best",
    "audio": "bestaudio/best",
}

COOKIE_PATH = "/app/cookies.txt"


def get_ydl_opts(quality: str = "best", fmt: str = "mp4") -> dict:
    opts = {
        "format":              QUALITY_MAP.get(quality, QUALITY_MAP["best"]),
        "merge_output_format": fmt,
        "quiet":               True,
        "no_warnings":         True,
    }
    if os.path.exists(COOKIE_PATH):
        opts["cookiefile"] = COOKIE_PATH
        log.info("Using cookies.txt for authentication")
    return opts


def _sync_extract(tweet_url: str, quality: str, fmt: str) -> list[MediaInfo]:
    opts = get_ydl_opts(quality, fmt)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(tweet_url, download=False)

    if not info:
        return []

    entries = info.get("entries") or [info]
    results = []

    for entry in entries:
        if not entry:
            continue

        formats = entry.get("formats") or []
        best = None
        best_h = -1
        for f in formats:
            h = f.get("height") or 0
            if f.get("vcodec", "none") != "none" and h > best_h:
                best_h = h
                best = f

        direct = (best or {}).get("url") or entry.get("url") or ""
        results.append(MediaInfo(
            title=entry.get("title") or entry.get("id") or "media",
            ext=entry.get("ext") or fmt,
            filesize=(best or {}).get("filesize"),
            thumbnail=entry.get("thumbnail"),
            duration=entry.get("duration"),
            width=(best or {}).get("width"),
            height=(best or {}).get("height"),
            format_id=(best or {}).get("format_id", "unknown"),
            direct_url=direct,
        ))

    return results


def _sync_list_formats(tweet_url: str) -> list[dict]:
    opts = {"quiet": True, "no_warnings": True}
    if os.path.exists(COOKIE_PATH):
        opts["cookiefile"] = COOKIE_PATH
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(tweet_url, download=False)
    return [
        {
            "format_id":  f.get("format_id"),
            "ext":        f.get("ext"),
            "resolution": f"{f.get('width','?')}x{f.get('height','?')}",
            "filesize":   f.get("filesize"),
            "vcodec":     f.get("vcodec"),
            "acodec":     f.get("acodec"),
            "tbr":        f.get("tbr"),
        }
        for f in (info or {}).get("formats", [])
    ]


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": "X Media Scraper API", "version": "1.0.0"}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}


@app.get("/extract", response_model=ExtractResponse, tags=["media"])
async def extract(
    url: str   = Query(...,    description="Full X/Twitter post URL"),
    quality: str = Query("best", description="best | 1080p | 720p | 480p | audio"),
    fmt: str   = Query("mp4",  description="mp4 | mkv | webm"),
):
    """
    Extract direct media stream URL(s) from an X post.
    The Chrome extension calls this, gets back direct_url, then
    triggers chrome.downloads.download() with it.
    """
    if not TWITTER_RE.match(url):
        raise HTTPException(status_code=422, detail="Invalid X/Twitter URL")

    try:
        loop = asyncio.get_event_loop()
        media_list = await loop.run_in_executor(
            None, _sync_extract, url, quality, fmt
        )
    except yt_dlp.utils.DownloadError as e:
        return ExtractResponse(success=False, tweet_url=url, media=[], error=str(e))
    except Exception as e:
        log.exception("Extraction error")
        raise HTTPException(status_code=500, detail=str(e))

    if not media_list:
        return ExtractResponse(
            success=False, tweet_url=url, media=[],
            error="No downloadable media found"
        )

    return ExtractResponse(success=True, tweet_url=url, media=media_list)


@app.get("/formats", tags=["media"])
async def list_formats(
    url: str = Query(..., description="Full X/Twitter post URL"),
):
    """List every available format/resolution for a tweet."""
    if not TWITTER_RE.match(url):
        raise HTTPException(status_code=422, detail="Invalid X/Twitter URL")
    try:
        loop = asyncio.get_event_loop()
        formats = await loop.run_in_executor(None, _sync_list_formats, url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"url": url, "formats": formats}


@app.get("/proxy-stream", tags=["media"])
async def proxy_stream(
    url: str      = Query(...,          description="Direct CDN stream URL"),
    filename: str = Query("media.mp4", description="Download filename"),
):
    """
    Proxy the raw video stream through Railway.
    Used when CDN URLs have CORS restrictions that block the extension.
    The extension calls this endpoint; Railway fetches and pipes the bytes.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://x.com/",
        "Origin":  "https://x.com",
    }

    async def stream_generator():
        async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    safe_filename = filename.replace('"', '_')
    return StreamingResponse(
        stream_generator(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Access-Control-Allow-Origin": "*",
        },
    )
