# YouTube Downloader

A local, single-user web app for downloading YouTube videos up to **4K (2160p)**
or extracting audio as **MP3**, with **playlist support**. Built with a FastAPI
backend, yt-dlp, and real-time progress tracking via Server-Sent Events. Runs
entirely on your own machine (localhost).

> ⚠️ For personal use only. Download only your own content, public-domain, or
> properly licensed material. Runs locally — no public deployment.

## ✨ Features

- Resolution selection from 360p up to 4K (2160p) — only resolutions **actually
  available** for the video are listed
- MP3 audio extraction (FFmpegExtractAudio, 192 kbps)
- **Playlist support** — select videos, batch download sequentially, get a ZIP archive
- Automatic video+audio merging via ffmpeg (for 4K DASH streams)
- Real-time progress bar (percent, speed, ETA) via Server-Sent Events (SSE)
- One-click launch (`run.bat`) — no commands to memorize
- Graceful error handling for private, age-restricted, geo-blocked videos and
  network failures

## 🛠️ Tech Stack

**Backend:** Python 3.11+, FastAPI, uvicorn, yt-dlp, SSE, threading
**Frontend:** Vanilla JS, HTML, CSS (dark theme)
**External:** ffmpeg (video/audio merging), Deno (yt-dlp JS runtime)

## 🚀 Quick Start (Windows)

1. **Install prerequisites:**
.

├── setup.bat           # First-time setup (Windows)

├── run.bat             # One-click launcher (Windows)

├── requirements.txt    # Python dependencies

├── main.py             # FastAPI backend

├── static/

│   ├── index.html      # Frontend markup + CSS

│   └── app.js          # Frontend logic

├── downloads/          # Download folder (auto-created, git-ignored)

└── README.md

## 🔍 How It Works

1. **Fetch Formats** — backend calls `yt_dlp.extract_info(download=False)` to inspect
   the URL without downloading, returning the resolutions actually available.
2. **Start Download** — a background thread runs `extract_info(download=True)` with a
   `progress_hooks` callback that pushes updates into an async queue.
3. **Progress Streaming** — the frontend connects to `/api/progress/{id}` via SSE; the
   backend streams JSON events to update the progress bar live.
4. **Ready & Serve** — the "ready" signal fires only **after** the blocking download
   call returns (i.e. after ffmpeg merge / MP3 extraction completes), so the file is
   never served while still being processed. Files persist on disk for repeated
   downloads and are auto-cleaned after 6 hours.

## 📋 Playlist Mode

Paste a playlist URL to see a scrollable list of its videos. Select the ones you want,
pick one resolution that applies to all, and download. Videos download sequentially; if
one fails (private/removed/geo-blocked) it is skipped and the batch continues. When
done, a ZIP archive is created, with individual files also available.

**Disk space:** a 12-video playlist at 1080p can easily exceed 1–2 GB. Files stay on
disk until the 6-hour cleanup runs.

## ⚙️ Optional yt-dlp Configs

If you hit YouTube bot-detection or sign-in errors, open `main.py` →
`get_common_ydl_opts()` and uncomment one of:

**(a) Browser cookies:**
```python
"cookiesfrombrowser": ("chrome",),  # or "firefox", "edge"
```

**(b) bgutil PO-token provider:**
```bash
pip install bgutil-ytdlp-pot-provider
```

## 🧰 Troubleshooting

| Issue | Solution |
|-------|----------|
| `ffmpeg not found` | Install ffmpeg and ensure it's on your PATH. |
| `Sign in to confirm you're not a bot` | Uncomment `cookiesfrombrowser` in `main.py` and restart. |
| `This video is private` | Requires authentication — use cookies or another video. |
| `HTTP Error 403: Forbidden` | Possible geo-block — try cookies or a different network. |
| Slow downloads | Usually YouTube rate-limiting; try again later. |
| File is `.webm` not `.mp4` | ffmpeg not found or merge failed — verify ffmpeg on PATH. |

## 📄 License

MIT — see [LICENSE](LICENSE).

## ⚠️ Disclaimer

This tool is for personal, local use. Respect YouTube's Terms of Service and only
download content you have the right to. The author is not responsible for misuse.