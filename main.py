import asyncio
import json
import re
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ───────────────────────────────
# Configuration
# ───────────────────────────────
DOWNLOAD_DIR = Path("./downloads")
DOWNLOAD_DIR.mkdir(exist_ok=True)
STATIC_DIR = Path("./static")

RESOLUTIONS = [
    ("360p", 360),
    ("480p", 480),
    ("720p", 720),
    ("1080p", 1080),
    ("1440p", 1440),
    ("2160p", 2160),
]

# Shared in-memory state (single-user, localhost only)
downloads: dict[str, "DownloadState"] = {}
downloads_lock = threading.Lock()


# ───────────────────────────────
# Data models
# ───────────────────────────────
@dataclass
class DownloadState:
    """Tracks a single download across the background thread and SSE endpoint."""

    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    done: bool = False
    error: str | None = None
    file_path: str | None = None
    title: str | None = None
    ext: str | None = None
    # Playlist fields
    files: dict[str, str] = field(default_factory=dict)          # video_id -> file_path
    video_titles: dict[str, str] = field(default_factory=dict)     # video_id -> title
    zip_path: str | None = None
    failures: list[str] = field(default_factory=list)
    total_videos: int = 0

    def put_progress(self, progress: dict) -> None:
        """Thread-safe progress push into the async queue."""
        try:
            self.loop.call_soon_threadsafe(self.queue.put_nowait, progress)
        except RuntimeError:
            pass


class FetchFormatsRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    resolution: str
    video_ids: list[str] | None = None


# ───────────────────────────────
# yt-dlp helpers
# ───────────────────────────────
def get_common_ydl_opts() -> dict[str, Any]:
    """Return a shared yt-dlp option block."""
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        # (a) Pass cookies from a browser
        # "cookiesfrombrowser": ("chrome",),
        # (b) bgutil PO-token provider
        # "extractor_args": {"youtube": {"player_client": ["web"], "po_token": ["bgutil"]}},
    }
    return opts


def extract_progress_data(d: dict) -> dict | None:
    """Transform a yt-dlp hook dict into a minimal SSE payload.

    Only returns data for "downloading" status. The hook's "finished" status
    means raw bytes are done but post-processing may still be running.
    """
    status = d.get("status")
    if status != "downloading":
        return None

    total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
    downloaded = d.get("downloaded_bytes", 0)
    percent = (downloaded / total * 100) if total else 0.0
    speed = d.get("speed")
    eta = d.get("eta")

    return {
        "status": "downloading",
        "percent": round(percent, 1),
        "downloaded": downloaded,
        "total": total,
        "speed": speed,
        "eta": eta,
        "speed_str": _human_readable_speed(speed),
        "eta_str": _human_readable_time(eta) if eta else "Unknown",
    }


def _human_readable_speed(bps: float | None) -> str:
    if not bps:
        return "Unknown"
    if bps < 1024:
        return f"{bps:.1f} B/s"
    elif bps < 1024 * 1024:
        return f"{bps / 1024:.1f} KB/s"
    return f"{bps / (1024 * 1024):.1f} MB/s"


def _human_readable_time(seconds: int | None) -> str:
    if seconds is None:
        return "Unknown"
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds // 3600}h {(seconds % 3600) // 60}m"


def _sanitize_filename(name: str) -> str:
    return re.sub(r'[<>"/\\|?*]', "", name).strip()


# ───────────────────────────────
# Background download workers
# ───────────────────────────────
def _do_download(url: str, resolution: str, download_id: str, state: DownloadState) -> None:
    """Single video download."""
    try:
        is_audio = resolution == "audio"
        outtmpl = str(DOWNLOAD_DIR / f"{download_id}.%(ext)s")

        def _progress_hook(d: dict) -> None:
            payload = extract_progress_data(d)
            if payload is not None:
                state.put_progress(payload)

        ydl_opts: dict[str, Any] = {
            **get_common_ydl_opts(),
            "format": "bestaudio/best" if is_audio else f"bestvideo[height<={int(resolution[:-1])}]+bestaudio/best[height<={int(resolution[:-1])}]",
            "outtmpl": outtmpl,
            "progress_hooks": [_progress_hook],
        }

        if not is_audio:
            ydl_opts["merge_output_format"] = "mp4"
        else:
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            state.title = info.get("title", "Unknown") if info else "Unknown"

        files = sorted(DOWNLOAD_DIR.glob(f"{download_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        final_files = [f for f in files if f.suffix not in (".part", ".ytdl", ".json", ".webm", ".m4a")]
        if final_files:
            state.file_path = str(final_files[0])
            state.ext = final_files[0].suffix[1:]
        else:
            raise RuntimeError("Download completed but no final output file was found.")

        state.put_progress({"status": "ready"})
        state.done = True

    except Exception as exc:
        state.error = str(exc)
        state.put_progress({"status": "error", "error": str(exc)})
        state.done = True


def _do_download_playlist(url: str, video_ids: list[str], resolution: str, download_id: str, state: DownloadState) -> None:
    """Playlist download — sequential per-video with skip-on-failure."""
    try:
        is_audio = resolution == "audio"
        total = len(video_ids)
        state.total_videos = total
        current = {"index": 0, "title": ""}

        def _progress_hook(d: dict) -> None:
            payload = extract_progress_data(d)
            if payload is not None:
                payload["current_index"] = current["index"]
                payload["total"] = total
                payload["video_title"] = current["title"]
                state.put_progress(payload)

        for i, video_id in enumerate(video_ids):
            video_url = f"https://www.youtube.com/watch?v={video_id}"
            current["index"] = i + 1
            try:
                outtmpl = str(DOWNLOAD_DIR / f"{download_id}_{video_id}.%(ext)s")
                ydl_opts: dict[str, Any] = {
                    **get_common_ydl_opts(),
                    "format": "bestaudio/best" if is_audio else f"bestvideo[height<={int(resolution[:-1])}]+bestaudio/best[height<={int(resolution[:-1])}]",
                    "outtmpl": outtmpl,
                    "progress_hooks": [_progress_hook],
                }

                if not is_audio:
                    ydl_opts["merge_output_format"] = "mp4"
                else:
                    ydl_opts["postprocessors"] = [
                        {
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3",
                            "preferredquality": "192",
                        }
                    ]

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(video_url, download=True)
                    title = info.get("title", "Unknown") if info else "Unknown"
                    current["title"] = title

                # Find the actual finished file
                files = sorted(
                    DOWNLOAD_DIR.glob(f"{download_id}_{video_id}.*"),
                    key=lambda p: p.stat().st_mtime, reverse=True,
                )
                final_files = [f for f in files if f.suffix not in (".part", ".ytdl", ".json", ".webm", ".m4a")]
                if not final_files:
                    raise RuntimeError("No final output file found after post-processing.")

                state.files[video_id] = str(final_files[0])
                state.video_titles[video_id] = title

            except Exception as exc:
                state.failures.append(f"Video {i + 1} ({video_id}): {str(exc)}")
                continue

        # Create zip of all succeeded files
        if state.files:
            zip_path = str(DOWNLOAD_DIR / f"{download_id}.zip")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for vid, fp in state.files.items():
                    zf.write(fp, arcname=Path(fp).name)
            state.zip_path = zip_path
            state.file_path = zip_path
            state.title = "Playlist"
            state.ext = "zip"

        state.put_progress({
            "status": "ready",
            "zip_ready": bool(state.zip_path),
            "succeeded": len(state.files),
            "skipped": len(state.failures),
            "failures": state.failures,
            "total": total,
            "video_ids": list(state.files.keys()),
        })
        state.done = True

    except Exception as exc:
        state.error = str(exc)
        state.put_progress({"status": "error", "error": str(exc)})
        state.done = True


# ───────────────────────────────
# Lifespan
# ───────────────────────────────
def _cleanup_old_downloads(max_age_hours: int = 6) -> None:
    """Remove stale files older than max_age_hours."""
    cutoff = time.time() - (max_age_hours * 3600)
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
            except OSError:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    _cleanup_old_downloads()
    yield
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file():
            try:
                f.unlink()
            except OSError:
                pass


# ───────────────────────────────
# FastAPI app
# ───────────────────────────────
app = FastAPI(title="Local YouTube Downloader", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/formats")
async def fetch_formats(req: FetchFormatsRequest):
    """Return available formats — single video or playlist."""
    try:
        opts = {**get_common_ydl_opts(), "extract_flat": "in_playlist"}

        def _extract():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(req.url, download=False)

        info = await asyncio.to_thread(_extract)

        # ── Playlist ──
        if info.get("_type") == "playlist":
            entries = info.get("entries") or []
            def _thumb(entry):
                t = entry.get("thumbnail")
                if t:
                    return t
                vid = entry.get("id")
                if vid:
                    return f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"
                return None
            return {
                "type": "playlist",
                "title": info.get("title", "Unknown Playlist"),
                "entries": [
                    {
                        "index": i,
                        "video_id": entry.get("id"),
                        "title": entry.get("title", "Unknown"),
                        "duration": entry.get("duration"),
                        "thumbnail": _thumb(entry),
                    }
                    for i, entry in enumerate(entries)
                ],
                # For playlists we can't determine max resolution without resolving every video,
                # so we offer all standard resolutions. yt-dlp will pick the best available at download time.
                "resolutions": [r[0] for r in RESOLUTIONS],
                "audio_available": True,
            }

        # ── Single video ──
        formats = info.get("formats", [])
        max_height = 0
        has_audio = False
        for f in formats:
            if f.get("vcodec") != "none":
                h = f.get("height") or 0
                if h > max_height:
                    max_height = h
            if f.get("acodec") != "none":
                has_audio = True

        available = [label for label, h in RESOLUTIONS if max_height >= h]

        return {
            "type": "video",
            "title": info.get("title", "Unknown"),
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "uploader": info.get("uploader"),
            "resolutions": available,
            "audio_available": has_audio,
        }

    except yt_dlp.utils.DownloadError as exc:
        raise HTTPException(status_code=400, detail=f"Download error: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error: {exc}")


@app.post("/api/download")
async def start_download(req: DownloadRequest):
    """Start a background download — single video or playlist."""
    valid_resolutions = [r[0] for r in RESOLUTIONS] + ["audio"]
    if req.resolution not in valid_resolutions:
        raise HTTPException(status_code=400, detail="Invalid resolution selected.")

    _cleanup_old_downloads(6)

    download_id = str(uuid.uuid4())[:8]
    state = DownloadState(loop=asyncio.get_running_loop())

    with downloads_lock:
        downloads[download_id] = state

    if req.video_ids:
        threading.Thread(
            target=_do_download_playlist,
            args=(req.url, req.video_ids, req.resolution, download_id, state),
            daemon=True,
        ).start()
    else:
        threading.Thread(
            target=_do_download,
            args=(req.url, req.resolution, download_id, state),
            daemon=True,
        ).start()

    return {"download_id": download_id}


@app.get("/api/progress/{download_id}")
async def progress_sse(download_id: str):
    """Server-Sent Events endpoint that streams download progress."""
    with downloads_lock:
        state = downloads.get(download_id)

    if not state:
        raise HTTPException(status_code=404, detail="Download not found.")

    async def event_generator():
        if state.done:
            if state.error:
                yield f"data: {json.dumps({'status': 'error', 'error': state.error})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'ready'})}\n\n"
            return

        while True:
            try:
                progress = await asyncio.wait_for(state.queue.get(), timeout=30.0)
                yield f"data: {json.dumps(progress)}\n\n"
                if progress.get("status") in ("ready", "error"):
                    break
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'status': 'keepalive'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/download/{download_id}")
async def download_file(download_id: str):
    """Serve the completed file (single video or playlist zip)."""
    with downloads_lock:
        state = downloads.get(download_id)

    if not state:
        raise HTTPException(status_code=404, detail="Download not found.")

    # Playlist zip takes priority
    if state.zip_path and Path(state.zip_path).exists():
        fp = Path(state.zip_path)
        ext = "zip"
        title = state.title or "playlist"
    else:
        files = sorted(DOWNLOAD_DIR.glob(f"{download_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        matches = [f for f in files if f.suffix not in (".part", ".ytdl", ".json", ".webm", ".m4a")]
        if not matches:
            raise HTTPException(status_code=404, detail="File not ready yet.")
        fp = matches[0]
        ext = fp.suffix[1:]
        title = state.title or "download"

    sanitized = _sanitize_filename(title)
    filename = f"{sanitized}.{ext}"

    return FileResponse(
        path=str(fp),
        filename=filename,
        media_type="application/octet-stream",
    )


@app.get("/api/download/{download_id}/video/{video_id}")
async def download_single_video(download_id: str, video_id: str):
    """Serve a single video from a playlist download."""
    with downloads_lock:
        state = downloads.get(download_id)

    if not state or not state.files:
        raise HTTPException(status_code=404, detail="Download not found.")

    file_path = state.files.get(video_id)
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="Video file not found.")

    fp = Path(file_path)
    ext = fp.suffix[1:]
    title = state.video_titles.get(video_id, "video")
    sanitized = _sanitize_filename(title)
    filename = f"{sanitized}.{ext}"

    return FileResponse(
        path=str(fp),
        filename=filename,
        media_type="application/octet-stream",
    )
