(() => {
    const $ = (id) => document.getElementById(id);

    const urlInput = $('url');
    const fetchBtn = $('fetchBtn');
    const downloadBtn = $('downloadBtn');
    const resolutionSelect = $('resolution');
    const videoInfo = $('videoInfo');
    const playlistInfo = $('playlistInfo');
    const controls = $('controls');
    const playlistControls = $('playlistControls');
    const playlistList = $('playlistList');
    const selectAll = $('selectAll');
    const selectedCount = $('selectedCount');
    const downloadSelectedBtn = $('downloadSelectedBtn');
    const progress = $('progress');
    const progressFill = $('progressFill');
    const progressInfo = $('progressInfo');
    const processing = $('processing');
    const result = $('result');
    const downloadFileBtn = $('downloadFileBtn');
    const playlistSummary = $('playlistSummary');
    const videoLinks = $('videoLinks');
    const downloadZipBtn = $('downloadZipBtn');
    const errorDiv = $('error');
    const titleEl = $('title');
    const metaEl = $('meta');
    const thumbnailEl = $('thumbnail');
    const playlistTitleEl = $('playlistTitle');
    const playlistMetaEl = $('playlistMeta');

    let currentUrl = '';
    let currentDownloadId = null;
    let eventSource = null;
    let isPlaylist = false;
    let playlistEntries = [];
    let selectedVideoIds = new Set();

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.classList.remove('hidden');
    }

    function hideError() {
        errorDiv.classList.add('hidden');
    }

    function resetUI() {
        videoInfo.classList.add('hidden');
        playlistInfo.classList.add('hidden');
        controls.classList.add('hidden');
        playlistControls.classList.add('hidden');
        playlistList.innerHTML = '';
        progress.classList.add('hidden');
        result.classList.add('hidden');
        playlistSummary.classList.add('hidden');
        videoLinks.classList.add('hidden');
        downloadZipBtn.classList.add('hidden');
        processing.classList.add('hidden');
        hideError();
        resolutionSelect.innerHTML = '<option value="">Select resolution…</option>';
        downloadBtn.disabled = true;
        downloadSelectedBtn.disabled = true;
        selectAll.checked = false;
        selectedCount.textContent = '0 selected';
        progressFill.style.width = '0%';
        progressInfo.textContent = '';
        isPlaylist = false;
        playlistEntries = [];
        selectedVideoIds.clear();
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    }

    function formatDuration(sec) {
        if (!sec) return '';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function populateResolutionDropdown(data) {
        resolutionSelect.innerHTML = '<option value="">Select resolution…</option>';
        data.resolutions.forEach((res) => {
            const opt = document.createElement('option');
            opt.value = res;
            opt.textContent = res;
            resolutionSelect.appendChild(opt);
        });
        if (data.audio_available) {
            const opt = document.createElement('option');
            opt.value = 'audio';
            opt.textContent = 'Audio only (MP3)';
            resolutionSelect.appendChild(opt);
        }
    }

    // ── Fetch formats ──
    async function fetchFormats() {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a YouTube URL.');
            return;
        }
        resetUI();
        currentUrl = url;
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Loading…';

        try {
            const res = await fetch('/api/formats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || 'Failed to fetch formats.');
            }

            if (data.type === 'playlist') {
                showPlaylist(data);
            } else {
                showSingleVideo(data);
            }
        } catch (err) {
            showError(err.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Fetch Formats';
        }
    }

    // ── Single video UI ──
    function showSingleVideo(data) {
        titleEl.textContent = data.title || 'Unknown title';
        let metaParts = [];
        if (data.uploader) metaParts.push(data.uploader);
        if (data.duration) metaParts.push(formatDuration(data.duration));
        metaEl.textContent = metaParts.join('  •  ');

        if (data.thumbnail) {
            thumbnailEl.innerHTML = `<img src="${data.thumbnail}" alt="Thumbnail" loading="lazy">`;
        } else {
            thumbnailEl.innerHTML = '';
        }
        videoInfo.classList.remove('hidden');
        populateResolutionDropdown(data);
        controls.classList.remove('hidden');
    }

    // ── Playlist UI ──
    function showPlaylist(data) {
        isPlaylist = true;
        playlistEntries = data.entries || [];
        playlistTitleEl.textContent = data.title || 'Unknown Playlist';
        playlistMetaEl.textContent = `${playlistEntries.length} videos`;
        playlistInfo.classList.remove('hidden');

        // Build rows
        playlistList.innerHTML = '';
        playlistEntries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'playlist-row';
            row.dataset.videoId = entry.video_id;

            const checked = selectedVideoIds.has(entry.video_id) ? 'checked' : '';
            const thumb = entry.thumbnail
                ? `<img src="${entry.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
                : '';
            const dur = entry.duration ? formatDuration(entry.duration) : '';

            row.innerHTML = `
                <input type="checkbox" ${checked} data-video-id="${entry.video_id}">
                ${thumb}
                <div class="thumb-placeholder" style="display:none; width:80px; height:45px; background:#1a1a2e; border-radius:6px; align-items:center; justify-content:center; color:#6a6a8a; font-size:0.7rem; flex-shrink:0;">IMG</div>
                <div class="info">
                    <div class="row-title">${escapeHtml(entry.title || 'Unknown')}</div>
                    <div class="row-duration">${dur}</div>
                </div>
            `;

            // Click row to toggle checkbox
            row.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = row.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                toggleVideo(entry.video_id, cb.checked);
            });

            // Checkbox change
            const cb = row.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', () => toggleVideo(entry.video_id, cb.checked));

            playlistList.appendChild(row);
        });

        // Resolution dropdown (same for all videos)
        populateResolutionDropdown(data);
        controls.classList.remove('hidden');
        playlistControls.classList.remove('hidden');
    }

    function toggleVideo(videoId, checked) {
        if (checked) selectedVideoIds.add(videoId);
        else selectedVideoIds.delete(videoId);
        updateSelectedCount();
    }

    function updateSelectedCount() {
        selectedCount.textContent = `${selectedVideoIds.size} selected`;
        downloadSelectedBtn.disabled = selectedVideoIds.size === 0;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Start download ──
    async function startDownload() {
        if (isPlaylist) {
            await startPlaylistDownload();
        } else {
            await startSingleDownload();
        }
    }

    async function startSingleDownload() {
        const resolution = resolutionSelect.value;
        if (!resolution) {
            showError('Please select a resolution.');
            return;
        }
        hideError();
        progress.classList.remove('hidden');
        result.classList.add('hidden');
        processing.classList.add('hidden');
        downloadBtn.disabled = true;
        fetchBtn.disabled = true;
        progressFill.style.width = '0%';
        progressInfo.textContent = 'Starting…';

        try {
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: currentUrl, resolution }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to start download.');
            currentDownloadId = data.download_id;
            connectProgress(data.download_id, 'single');
        } catch (err) {
            showError(err.message);
            downloadBtn.disabled = false;
            fetchBtn.disabled = false;
        }
    }

    async function startPlaylistDownload() {
        const resolution = resolutionSelect.value;
        if (!resolution) {
            showError('Please select a resolution.');
            return;
        }
        if (selectedVideoIds.size === 0) {
            showError('Please select at least one video.');
            return;
        }
        hideError();
        progress.classList.remove('hidden');
        result.classList.add('hidden');
        playlistSummary.classList.add('hidden');
        videoLinks.classList.add('hidden');
        downloadZipBtn.classList.add('hidden');
        processing.classList.add('hidden');
        downloadSelectedBtn.disabled = true;
        fetchBtn.disabled = true;
        progressFill.style.width = '0%';
        progressInfo.textContent = 'Starting…';

        try {
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: currentUrl,
                    resolution,
                    video_ids: Array.from(selectedVideoIds),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to start download.');
            currentDownloadId = data.download_id;
            connectProgress(data.download_id, 'playlist');
        } catch (err) {
            showError(err.message);
            downloadSelectedBtn.disabled = false;
            fetchBtn.disabled = false;
        }
    }

    // ── SSE progress ──
    function connectProgress(downloadId, mode) {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`/api/progress/${downloadId}`);

        eventSource.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.status === 'keepalive') return;

            if (msg.status === 'error') {
                progressInfo.textContent = '';
                progressFill.style.width = '100%';
                progressFill.style.background = '#ff6b6b';
                processing.classList.add('hidden');
                eventSource.close();
                if (mode === 'playlist') {
                    downloadSelectedBtn.disabled = false;
                } else {
                    downloadBtn.disabled = false;
                }
                fetchBtn.disabled = false;
                return;
            }

            if (msg.status === 'ready') {
                progressInfo.textContent = '';
                processing.classList.add('hidden');
                eventSource.close();
                if (mode === 'playlist') {
                    showPlaylistSummary(downloadId, msg);
                } else {
                    showSingleVideoDownload(downloadId);
                }
                if (mode === 'playlist') {
                    downloadSelectedBtn.disabled = false;
                } else {
                    downloadBtn.disabled = false;
                }
                fetchBtn.disabled = false;
                return;
            }

            if (msg.status === 'downloading') {
                const pct = msg.percent || 0;
                progressFill.style.width = `${pct}%`;
                progressFill.style.background = '';
                if (mode === 'playlist') {
                    const idx = msg.current_index || 0;
                    const total = msg.total || 1;
                    const title = msg.video_title || '';
                    progressInfo.textContent = `Video ${idx}/${total}: ${title} — ${pct}%`;
                    if (pct >= 100) {
                        processing.classList.remove('hidden');
                    } else {
                        processing.classList.add('hidden');
                    }
                } else {
                    if (pct >= 100) {
                        progressInfo.textContent = '';
                        processing.classList.remove('hidden');
                    } else {
                        processing.classList.add('hidden');
                        const parts = [`${pct}%`];
                        if (msg.speed_str && msg.speed_str !== 'Unknown') {
                            parts.push(msg.speed_str);
                        }
                        if (msg.eta_str && msg.eta_str !== 'Unknown') {
                            parts.push(`ETA ${msg.eta_str}`);
                        }
                        progressInfo.textContent = parts.join('  •  ');
                    }
                }
            }
        };

        eventSource.onerror = () => {
            progressInfo.textContent = 'Connection lost. Please retry.';
            processing.classList.add('hidden');
            eventSource.close();
            if (mode === 'playlist') {
                downloadSelectedBtn.disabled = false;
            } else {
                downloadBtn.disabled = false;
            }
            fetchBtn.disabled = false;
        };
    }

    // ── File download (blob) ──
    async function handleFileDownload(downloadId, videoId = null) {
        const path = videoId
            ? `/api/download/${downloadId}/video/${videoId}`
            : `/api/download/${downloadId}`;
        try {
            const res = await fetch(path);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                showError(data.detail || `Download failed (${res.status})`);
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const cd = res.headers.get('content-disposition') || '';
            let filename = 'video';
            const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
            if (m) {
                filename = decodeURIComponent(m[1]);
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showError(err.message);
        }
    }

    // ── Show single video download button ──
    function showSingleVideoDownload(downloadId) {
        downloadFileBtn.textContent = 'Download File';
        downloadFileBtn.onclick = () => handleFileDownload(downloadId);
        downloadFileBtn.classList.remove('hidden');
        result.classList.remove('hidden');
    }

    // ── Show playlist summary ──
    function showPlaylistSummary(downloadId, msg) {
        result.classList.remove('hidden');
        downloadFileBtn.classList.add('hidden');

        const succeeded = msg.succeeded || 0;
        const skipped = msg.skipped || 0;
        const total = msg.total || 0;

        let html = `<h3>Download complete</h3>`;
        html += `<p><strong>${succeeded}</strong> of <strong>${total}</strong> succeeded</p>`;
        if (skipped > 0) {
            html += `<p><strong>${skipped}</strong> skipped</p>`;
        }
        if (msg.failures && msg.failures.length > 0) {
            html += `<div class="failures">`;
            html += msg.failures.map((f) => `<div>${escapeHtml(f)}</div>`).join('');
            html += `</div>`;
        }
        playlistSummary.innerHTML = html;
        playlistSummary.classList.remove('hidden');

        // Zip button
        if (msg.zip_ready) {
            downloadZipBtn.classList.remove('hidden');
            downloadZipBtn.onclick = () => handleFileDownload(downloadId);
        }

        // Per-video links
        videoLinks.innerHTML = '';
        // We need to match videoIds to titles. We stored them in the entries.
        const entryMap = new Map(playlistEntries.map((e) => [e.video_id, e]));
        for (const videoId of (msg.video_ids || [])) {
            const entry = entryMap.get(videoId);
            if (!entry) continue;
            const row = document.createElement('div');
            row.className = 'video-link-row';
            row.innerHTML = `
                <span>${escapeHtml(entry.title || 'Unknown')}</span>
                <button>Download</button>
            `;
            row.querySelector('button').onclick = () => handleFileDownload(downloadId, videoId);
            videoLinks.appendChild(row);
        }
        if (videoLinks.children.length > 0) {
            videoLinks.classList.remove('hidden');
        }
    }

    // ── Event listeners ──
    selectAll.addEventListener('change', () => {
        const boxes = playlistList.querySelectorAll('input[type="checkbox"]');
        boxes.forEach((box) => {
            box.checked = selectAll.checked;
            const vid = box.dataset.videoId;
            if (selectAll.checked) selectedVideoIds.add(vid);
            else selectedVideoIds.delete(vid);
        });
        updateSelectedCount();
    });

    fetchBtn.addEventListener('click', fetchFormats);
    downloadBtn.addEventListener('click', startDownload);
    downloadSelectedBtn.addEventListener('click', startPlaylistDownload);
    resolutionSelect.addEventListener('change', () => {
        downloadBtn.disabled = !resolutionSelect.value;
    });
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fetchFormats();
    });
})();
