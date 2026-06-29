(() => {
    const $ = (id) => document.getElementById(id);

    const urlInput = $('url');
    const fetchBtn = $('fetchBtn');
    const errorDiv = $('error');
    const videoCard = $('videoCard');
    const videoThumb = $('videoThumb');
    const videoTitle = $('videoTitle');
    const videoMeta = $('videoMeta');
    const playlistHeader = $('playlistHeader');
    const playlistTitle = $('playlistTitle');
    const playlistMeta = $('playlistMeta');
    const resolutionArea = $('resolutionArea');
    const resolutionPills = $('resolutionPills');
    const playlistListCard = $('playlistListCard');
    const playlistList = $('playlistList');
    const selectAll = $('selectAll');
    const selectedCount = $('selectedCount');
    const downloadArea = $('downloadArea');
    const downloadBtn = $('downloadBtn');
    const progressArea = $('progressArea');
    const progressBar = $('progressBar');
    const progressText = $('progressText');
    const progressDetail = $('progressDetail');
    const resultArea = $('resultArea');
    const resultContent = $('resultContent');
    const resultActions = $('resultActions');
    const videoLinks = $('videoLinks');

    let currentUrl = '';
    let currentDownloadId = null;
    let eventSource = null;
    let isPlaylist = false;
    let playlistEntries = [];
    let selectedVideoIds = new Set();
    let selectedResolution = null;

    // ── Helpers ──
    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.classList.remove('hidden');
    }
    function hideError() {
        errorDiv.classList.add('hidden');
    }

    function resetUI() {
        hideError();
        videoCard.classList.add('hidden');
        playlistHeader.classList.add('hidden');
        resolutionArea.classList.add('hidden');
        playlistListCard.classList.add('hidden');
        downloadArea.classList.add('hidden');
        progressArea.classList.add('hidden');
        resultArea.classList.add('hidden');
        videoLinks.classList.add('hidden');
        resultContent.innerHTML = '';
        resultActions.innerHTML = '';
        videoLinks.innerHTML = '';
        resolutionPills.innerHTML = '';
        playlistList.innerHTML = '';
        selectAll.checked = false;
        selectedVideoIds.clear();
        selectedResolution = null;
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Download';
        progressBar.style.width = '0%';
        progressBar.classList.remove('processing');
        progressText.textContent = '';
        progressDetail.textContent = '';
        isPlaylist = false;
        playlistEntries = [];
        if (eventSource) { eventSource.close(); eventSource = null; }
    }

    function formatDuration(sec) {
        if (!sec) return '';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function setResolution(value) {
        selectedResolution = value;
        const pills = resolutionPills.querySelectorAll('.pill');
        pills.forEach((p) => {
            if (p.dataset.value === value) p.classList.add('pill-active');
            else p.classList.remove('pill-active');
        });
        downloadBtn.disabled = !value;
    }

    // ── Populate resolution pills ──
    function populateResolutionPills(data) {
        resolutionPills.innerHTML = '';
        const resolutions = data.resolutions || [];
        const hasAudio = data.audio_available;

        resolutions.forEach((res) => {
            const btn = document.createElement('button');
            btn.className = 'pill';
            btn.textContent = res;
            btn.dataset.value = res;
            btn.addEventListener('click', () => setResolution(res));
            resolutionPills.appendChild(btn);
        });

        if (hasAudio) {
            const btn = document.createElement('button');
            btn.className = 'pill';
            btn.textContent = 'Audio Only';
            btn.dataset.value = 'audio';
            btn.addEventListener('click', () => setResolution('audio'));
            resolutionPills.appendChild(btn);
        }
    }

    // ── Fetch ──
    async function fetchFormats() {
        const url = urlInput.value.trim();
        if (!url) { showError('Please enter a YouTube URL.'); return; }
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
            if (!res.ok) throw new Error(data.detail || 'Failed to fetch formats.');

            if (data.type === 'playlist') showPlaylist(data);
            else showSingleVideo(data);

            resolutionArea.classList.remove('hidden');
            resolutionArea.classList.add('fade-in');
            downloadArea.classList.remove('hidden');
        } catch (err) {
            showError(err.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Fetch';
        }
    }

    // ── Single video ──
    function showSingleVideo(data) {
        isPlaylist = false;
        videoThumb.src = data.thumbnail || '';
        videoThumb.alt = data.title || 'Thumbnail';
        videoTitle.textContent = data.title || 'Unknown title';
        const parts = [];
        if (data.uploader) parts.push(data.uploader);
        if (data.duration) parts.push(formatDuration(data.duration));
        videoMeta.textContent = parts.join('  •  ');
        videoCard.classList.remove('hidden');
        videoCard.classList.add('fade-in');
        populateResolutionPills(data);
    }

    // ── Playlist ──
    function showPlaylist(data) {
        isPlaylist = true;
        playlistEntries = data.entries || [];
        playlistTitle.textContent = data.title || 'Unknown Playlist';
        playlistMeta.textContent = `${playlistEntries.length} video${playlistEntries.length !== 1 ? 's' : ''}`;
        playlistHeader.classList.remove('hidden');
        playlistHeader.classList.add('fade-in');

        populateResolutionPills(data);

        playlistList.innerHTML = '';
        playlistEntries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'list-item';
            row.dataset.videoId = entry.video_id;

            const thumb = entry.thumbnail
                ? `<img class="thumb" src="${entry.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="thumb-placeholder" style="display:none">IMG</div>`
                : `<div class="thumb-placeholder" style="display:flex">IMG</div>`;
            const dur = entry.duration ? formatDuration(entry.duration) : '';

            row.innerHTML = `
                <input type="checkbox" data-video-id="${entry.video_id}">
                ${thumb}
                <div class="meta">
                    <div class="title">${escapeHtml(entry.title || 'Unknown')}</div>
                    <div class="dur">${dur}</div>
                </div>
            `;

            row.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = row.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                toggleVideo(entry.video_id, cb.checked);
            });

            const cb = row.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', () => toggleVideo(entry.video_id, cb.checked));

            playlistList.appendChild(row);
        });

        playlistListCard.classList.remove('hidden');
        playlistListCard.classList.add('fade-in');
        downloadBtn.textContent = 'Download Selected';
    }

    function toggleVideo(videoId, checked) {
        if (checked) selectedVideoIds.add(videoId);
        else selectedVideoIds.delete(videoId);
        updateSelectedCount();
    }

    function updateSelectedCount() {
        const count = selectedVideoIds.size;
        selectedCount.textContent = `${count} selected`;
        if (isPlaylist) downloadBtn.disabled = count === 0 || !selectedResolution;
    }

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

    // ── Start download ──
    async function startDownload() {
        if (!selectedResolution) { showError('Please select a quality.'); return; }
        if (isPlaylist && selectedVideoIds.size === 0) { showError('Please select at least one video.'); return; }

        hideError();
        progressArea.classList.remove('hidden');
        progressArea.classList.add('fade-in');
        resultArea.classList.add('hidden');
        videoLinks.classList.add('hidden');
        downloadBtn.disabled = true;
        fetchBtn.disabled = true;
        progressBar.style.width = '0%';
        progressBar.classList.remove('processing');
        progressText.textContent = 'Preparing…';
        progressDetail.textContent = '';

        try {
            const body = isPlaylist
                ? { url: currentUrl, resolution: selectedResolution, video_ids: Array.from(selectedVideoIds) }
                : { url: currentUrl, resolution: selectedResolution };
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to start download.');
            currentDownloadId = data.download_id;
            connectProgress(data.download_id, isPlaylist ? 'playlist' : 'single');
        } catch (err) {
            showError(err.message);
            downloadBtn.disabled = false;
            fetchBtn.disabled = false;
        }
    }

    // ── Blob download ──
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
            if (m) filename = decodeURIComponent(m[1]);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showError(err.message);
        }
    }

    // ── SSE Progress ──
    function connectProgress(downloadId, mode) {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`/api/progress/${downloadId}`);

        eventSource.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.status === 'keepalive') return;

            if (msg.status === 'error') {
                progressBar.classList.remove('processing');
                progressBar.style.width = '100%';
                progressBar.style.background = 'var(--danger)';
                progressText.textContent = 'Error';
                progressDetail.textContent = msg.error;
                eventSource.close();
                downloadBtn.disabled = false;
                fetchBtn.disabled = false;
                return;
            }

            if (msg.status === 'ready') {
                progressBar.classList.remove('processing');
                progressBar.style.width = '100%';
                progressText.textContent = 'Complete';
                progressDetail.textContent = '';
                eventSource.close();
                if (mode === 'playlist') showPlaylistResult(downloadId, msg);
                else showSingleResult(downloadId);
                downloadBtn.disabled = false;
                fetchBtn.disabled = false;
                return;
            }

            if (msg.status === 'downloading') {
                const pct = msg.percent || 0;
                progressBar.style.width = `${pct}%`;
                progressBar.style.background = 'var(--accent)';
                progressBar.classList.remove('processing');

                if (mode === 'playlist') {
                    const idx = msg.current_index || 0;
                    const total = msg.total || 1;
                    const title = msg.video_title || '';
                    progressText.textContent = `${title || 'Downloading'}`;
                    progressDetail.textContent = `Video ${idx} of ${total} — ${pct}%`;

                    if (pct >= 100) {
                        progressBar.classList.add('processing');
                        progressDetail.textContent = 'Processing video…';
                    }
                } else {
                    if (pct >= 100) {
                        progressBar.classList.add('processing');
                        progressText.textContent = 'Processing…';
                        progressDetail.textContent = 'Converting / merging';
                    } else {
                        progressText.textContent = `${pct}%`;
                        const parts = [];
                        if (msg.speed_str && msg.speed_str !== 'Unknown') parts.push(msg.speed_str);
                        if (msg.eta_str && msg.eta_str !== 'Unknown') parts.push(`ETA ${msg.eta_str}`);
                        progressDetail.textContent = parts.join('  •  ');
                    }
                }
            }
        };

        eventSource.onerror = () => {
            progressText.textContent = 'Connection lost';
            progressDetail.textContent = 'Please try again';
            progressBar.classList.remove('processing');
            eventSource.close();
            downloadBtn.disabled = false;
            fetchBtn.disabled = false;
        };
    }

    // ── Show single result ──
    function showSingleResult(downloadId) {
        resultContent.innerHTML = '<h3>Ready</h3><p class="summary-line">Your file is ready to download.</p>';
        resultActions.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = 'Download File';
        btn.onclick = () => handleFileDownload(downloadId);
        resultActions.appendChild(btn);
        resultArea.classList.remove('hidden');
        resultArea.classList.add('fade-in');
    }

    // ── Show playlist result ──
    function showPlaylistResult(downloadId, msg) {
        const succeeded = msg.succeeded || 0;
        const skipped = msg.skipped || 0;
        const total = msg.total || 0;

        let html = '<h3>Download Complete</h3>';
        html += `<p class="summary-line"><strong>${succeeded}</strong> of <strong>${total}</strong> videos succeeded</p>`;
        if (skipped > 0) html += `<p class="summary-line"><strong>${skipped}</strong> skipped</p>`;
        if (msg.failures && msg.failures.length > 0) {
            html += `<div class="failures">${msg.failures.map((f) => `<div>${escapeHtml(f)}</div>`).join('')}</div>`;
        }
        resultContent.innerHTML = html;

        resultActions.innerHTML = '';
        if (msg.zip_ready) {
            const zipBtn = document.createElement('button');
            zipBtn.className = 'btn-primary';
            zipBtn.textContent = 'Download All (ZIP)';
            zipBtn.onclick = () => handleFileDownload(downloadId);
            resultActions.appendChild(zipBtn);
        }

        videoLinks.innerHTML = '';
        const entryMap = new Map(playlistEntries.map((e) => [e.video_id, e]));
        for (const videoId of (msg.video_ids || [])) {
            const entry = entryMap.get(videoId);
            if (!entry) continue;
            const row = document.createElement('div');
            row.className = 'vlink-row';
            row.innerHTML = `<span>${escapeHtml(entry.title || 'Unknown')}</span>`;
            const btn = document.createElement('button');
            btn.className = 'btn-primary';
            btn.textContent = 'Download';
            btn.onclick = () => handleFileDownload(downloadId, videoId);
            row.appendChild(btn);
            videoLinks.appendChild(row);
        }
        if (videoLinks.children.length > 0) videoLinks.classList.remove('hidden');

        resultArea.classList.remove('hidden');
        resultArea.classList.add('fade-in');
    }

    // ── Event listeners ──
    fetchBtn.addEventListener('click', fetchFormats);
    downloadBtn.addEventListener('click', startDownload);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchFormats(); });
})();
