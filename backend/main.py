"""
X Media Scraper — FastAPI Backend
Deployed on Railway. Exposes endpoints consumed by the Chrome Extension.
"""

import os
import re
import asyncio
import logging
import time
import tempfile
from typing import Optional
from contextlib import asynccontextmanager
from urllib.parse import urlparse

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

# Default to OPEN for development (extension testing), RESTRICTED for production
is_production = os.getenv("ENV") == "production"

if is_production:
    cors_origins = [
        "https://x.com",
        "https://twitter.com",
        "https://www.x.com",
        "https://www.twitter.com",
    ]
else:
    # Development: Allow all + extension (for unpacked extension testing)
    cors_origins = [
        "*",
        "chrome-extension://*",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
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
MAX_STREAM_SIZE = 5 * 1024 * 1024 * 1024  # 5GB limit per file

# Allowed CDN domains for proxy-stream
ALLOWED_DOMAINS = [
    "twimg.com",
    "pbs.twimg.com",
    "video.twimg.com",
    "twitter.com",
    "x.com",
]

def is_safe_cdn_url(url: str) -> bool:
    """Validate that URL is from an allowed CDN to prevent SSRF attacks."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove port if present
        domain = domain.split(':')[0]
        return any(domain.endswith(d) for d in ALLOWED_DOMAINS)
    except Exception:
        return False


def sanitize_filename(name: str) -> str:
    """Sanitize filename: remove dangerous/unwanted chars, emoji, and bad extensions."""
    # Remove emoji and unicode special characters, keep only ASCII alphanumeric and basic symbols
    clean = re.sub(r'[\u00A0-\u9999\u2000-\u200D\uFEFF<>:"/\\|?*]', '_', name)
    # Remove multiple underscores
    clean = re.sub(r'_+', '_', clean)
    # Remove leading/trailing underscores and dots
    clean = re.sub(r'^_+|_+$', '', clean)
    # Remove unwanted file extensions that might be embedded in the name
    clean = re.sub(r'\.(json|unknown|tmp|temp|error)$', '', clean, flags=re.IGNORECASE)
    # Limit length
    clean = clean[:200]
    
    return clean or "media"


def get_ydl_opts(quality: str = "best", fmt: str = "mp4") -> dict:
    opts = {
        "format":              QUALITY_MAP.get(quality, QUALITY_MAP["best"]),
        "merge_output_format": fmt,
        "quiet":               True,
        "no_warnings":         True,
        "allow_unplayable_formats": True,
        # FFmpeg postprocessor to convert any format to mp4
        "postprocessors": [
            {
                "key": "FFmpegVideoConvertor",
                "preferedformat": fmt,  # Convert to mp4/mkv/webm
            }
        ],
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
        
        # If the URL is m3u8 (HLS playlist), it needs to be downloaded via proxy-stream
        # The extension will automatically use proxy mode for m3u8 URLs
        is_m3u8 = direct.endswith(".m3u8") or ".m3u8" in direct
        
        # Validate ext - if it's "json" or unknown, use the format parameter instead
        ext = entry.get("ext") or fmt
        valid_extensions = {"mp4", "mkv", "webm", "m3u8", "ts", "flv"}
        if ext not in valid_extensions:
            ext = fmt  # Fall back to requested format if ext is unknown
        
        results.append(MediaInfo(
            title=entry.get("title") or entry.get("id") or "media",
            ext=ext,
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
    url: str   = Query(..., min_length=10, max_length=2000, description="Full X/Twitter post URL"),
    quality: str = Query("best", regex="^(best|1080p|720p|480p|audio)$", description="best | 1080p | 720p | 480p | audio"),
    fmt: str   = Query("mp4", regex="^(mp4|mkv|webm)$", description="mp4 | mkv | webm"),
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
        log.warning(f"Download error for {url}: {e}")
        return ExtractResponse(success=False, tweet_url=url, media=[], error="Unable to extract media from this post")
    except Exception as e:
        log.exception(f"Unexpected error extracting {url}")
        return ExtractResponse(success=False, tweet_url=url, media=[], error="Internal server error")

    if not media_list:
        return ExtractResponse(
            success=False, tweet_url=url, media=[],
            error="No downloadable media found"
        )

    return ExtractResponse(success=True, tweet_url=url, media=media_list)


@app.get("/formats", tags=["media"])
async def list_formats(
    url: str = Query(..., min_length=10, max_length=2000, description="Full X/Twitter post URL"),
):
    """List every available format/resolution for a tweet."""
    if not TWITTER_RE.match(url):
        raise HTTPException(status_code=422, detail="Invalid X/Twitter URL")
    try:
        loop = asyncio.get_event_loop()
        formats = await loop.run_in_executor(None, _sync_list_formats, url)
    except Exception as e:
        log.exception(f"Error listing formats for {url}")
        raise HTTPException(status_code=500, detail="Unable to retrieve formats")
    return {"url": url, "formats": formats}


@app.get("/proxy-stream", tags=["media"])
async def proxy_stream(
    url: str      = Query(..., description="Direct CDN stream URL or m3u8 playlist"),
    filename: str = Query("media.mp4", max_length=200, description="Download filename"),
):
    """
    Proxy the raw video stream through Railway.
    Used when CDN URLs have CORS restrictions that block the extension.
    Also handles HLS (m3u8) streams by downloading and converting to mp4.
    
    Security: Only allows streaming from whitelisted CDN domains to prevent SSRF attacks.
    """
    # Sanitize filename IMMEDIATELY to prevent unicode encoding errors in headers
    filename = sanitize_filename(filename)
    
    # Validate URL is from safe CDN
    if not is_safe_cdn_url(url):
        log.warning(f"Blocked proxy-stream attempt to unsafe domain: {url}")
        raise HTTPException(status_code=403, detail="CDN domain not allowed")
    
    # Check if this is an m3u8 (HLS) URL - needs special handling
    if url.endswith(".m3u8") or ".m3u8" in url:
        log.info(f"Detected m3u8 playlist: {url}")
        
        # Try to convert m3u8 to mp4, but fall back to direct m3u8 stream if it fails
        try:
            log.info(f"Attempting to download and convert m3u8 to mp4")
            loop = asyncio.get_event_loop()
            mp4_file = await loop.run_in_executor(
                None,
                download_hls_as_mp4,
                url
            )
            
            if mp4_file and os.path.exists(mp4_file):
                file_size = os.path.getsize(mp4_file)
                log.info(f"HLS conversion successful, file size: {file_size} bytes")
                
                # Stream the converted mp4 file
                async def file_generator():
                    try:
                        with open(mp4_file, "rb") as f:
                            bytes_sent = 0
                            while True:
                                chunk = f.read(65536)
                                if not chunk:
                                    break
                                bytes_sent += len(chunk)
                                yield chunk
                            log.info(f"Successfully streamed {bytes_sent} bytes from converted mp4")
                    except Exception as e:
                        log.error(f"Error streaming file: {e}")
                        raise
                    finally:
                        # Clean up temp file after streaming
                        try:
                            os.remove(mp4_file)
                            log.info(f"Cleaned up temp file: {mp4_file}")
                        except Exception as e:
                            log.warning(f"Failed to delete temp file: {e}")
                
                safe_filename = filename
                if not safe_filename.endswith(".mp4"):
                    safe_filename = safe_filename + ".mp4"
                
                log.info(f"Streaming converted mp4 as: {safe_filename}")
                
                return StreamingResponse(
                    file_generator(),
                    media_type="video/mp4",
                    headers={
                        "Content-Disposition": f'attachment; filename="{safe_filename}"',
                    },
                )
        except Exception as e:
            log.warning(f"HLS conversion failed: {type(e).__name__}: {e}, falling back to direct m3u8 stream")
        
        # Fallback: stream the m3u8 playlist directly
        log.info(f"Streaming m3u8 playlist directly to browser")
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Referer": "https://x.com/",
            "Origin":  "https://x.com",
        }
        
        async def m3u8_generator():
            try:
                async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
                    async with client.stream("GET", url, headers=headers) as resp:
                        resp.raise_for_status()
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            yield chunk
            except Exception as e:
                log.error(f"Error streaming m3u8: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to fetch m3u8 playlist: {str(e)[:100]}")
        
        safe_filename = filename
        if not safe_filename.endswith(".m3u8"):
            safe_filename = safe_filename + ".m3u8"
        
        return StreamingResponse(
            m3u8_generator(),
            media_type="application/vnd.apple.mpegurl",  # Proper MIME type for m3u8
            headers={
                "Content-Disposition": f'inline; filename="{safe_filename}"',  # Use inline so browser tries to play it
            },
        )
    
    # For non-m3u8 URLs, use direct streaming
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
        bytes_sent = 0
        async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                resp.raise_for_status()
                # Check Content-Length header
                content_length = resp.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > MAX_STREAM_SIZE:
                            log.warning(f"Stream size {content_length} exceeds limit")
                            raise HTTPException(status_code=413, detail="File too large")
                    except ValueError:
                        pass
                
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    bytes_sent += len(chunk)
                    if bytes_sent > MAX_STREAM_SIZE:
                        log.warning(f"Stream exceeded max size: {bytes_sent} bytes")
                        raise HTTPException(status_code=413, detail="Stream exceeded maximum size")
                    yield chunk

    # Use filename (already sanitized at function start)
    safe_filename = filename
    
    return StreamingResponse(
        stream_generator(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
        },
    )


def download_hls_as_mp4(url: str) -> str:
    """Download HLS/m3u8 stream and convert to mp4 using yt-dlp."""
    temp_dir = tempfile.gettempdir()
    timestamp = int(time.time() * 1000)  # Use milliseconds for uniqueness
    temp_filename = os.path.join(temp_dir, f"xdl_{timestamp}.mp4")
    
    # yt-dlp requires the template WITHOUT the extension - it adds it
    output_template = temp_filename.replace(".mp4", "")
    
    opts = {
        "format": "best",
        "merge_output_format": "mp4",
        "quiet": False,  # Set to False to see errors
        "no_warnings": False,
        "outtmpl": output_template,
        "postprocessors": [
            {
                "key": "FFmpegVideoConvertor",
                "preferedformat": "mp4",
            }
        ],
    }
    
    try:
        log.info(f"Downloading HLS stream: {url}")
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.download([url])
        
        # Check if the file was created - try with and without .mp4 extension
        # (yt-dlp may or may not add extension depending on whether conversion happened)
        if os.path.exists(temp_filename):
            log.info(f"Successfully created mp4 file: {temp_filename}")
            return temp_filename
        elif os.path.exists(output_template):
            # File was created without .mp4 extension - rename it
            log.info(f"Found file at {output_template}, renaming to {temp_filename}")
            os.rename(output_template, temp_filename)
            return temp_filename
        else:
            log.error(f"HLS download failed - output file not found at {temp_filename} or {output_template}")
            raise Exception("HLS download did not produce output file")
    except Exception as e:
        log.error(f"Error downloading HLS stream: {e}", exc_info=True)
        raise
