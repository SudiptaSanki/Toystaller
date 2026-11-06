// player.js
// Handles video playback and direct download inside the Toystaller Player tab.
// Supports both direct MP4 streams and HLS adaptive VOD streams via Hls.js and client-side fMP4 assembly.

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('url');

    const player = document.getElementById('videoPlayer');
    const dlBtn = document.getElementById('dlBtn');
    const copyBtn = document.getElementById('copyBtn');
    const resText = document.getElementById('resolutionText');

    if (!rawUrl) {
        document.body.innerHTML = `
            <div style="color:#e4e6eb;font-family:sans-serif;text-align:center;margin-top:25vh;">
                <h2>No video link specified</h2>
                <p style="margin-top:10px;color:#8a8d91;">Please close this tab and click the download button on a LinkedIn video.</p>
            </div>
        `;
        return;
    }

    // Strip any fragment identifier so standard media elements can stream directly
    const videoUrl = rawUrl.split('#')[0];
    const isHls = videoUrl.includes('/pl/') || videoUrl.includes('.m3u8') || videoUrl.includes('format=m3u8');

    let hlsInstance = null;

    function initPlayer() {
        if (isHls && window.Hls && Hls.isSupported()) {
            hlsInstance = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90
            });

            hlsInstance.loadSource(videoUrl);
            hlsInstance.attachMedia(player);

            hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                player.play().catch(() => {});
                if (data && data.levels && data.levels.length > 0) {
                    const best = data.levels.reduce((p, c) => (c.height > p.height ? c : p), data.levels[0]);
                    resText.textContent = `${best.width || 'HD'} x ${best.height || '720'} • HD Video`;
                    resText.style.color = '#8a8d91';
                }
            });

            hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                if (hlsInstance.levels && hlsInstance.levels[data.level]) {
                    const l = hlsInstance.levels[data.level];
                    resText.textContent = `${l.width} x ${l.height} • HD Video`;
                }
            });

            hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.warn('HLS fatal error:', data);
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hlsInstance.recoverMediaError();
                            break;
                        default:
                            resText.textContent = 'Unable to stream directly. Please click "Download Video" above to save the file.';
                            resText.style.color = '#e74c3c';
                            break;
                    }
                }
            });
        } else {
            player.src = videoUrl;

            player.addEventListener('loadedmetadata', () => {
                if (player.videoWidth && player.videoHeight) {
                    resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
                    resText.style.color = '#8a8d91';
                }
            });

            player.addEventListener('error', (e) => {
                console.warn('Player video error:', player.error, e);
                // Attempt fallback to Hls if native player failed on unrecognized HLS format
                if (window.Hls && Hls.isSupported() && !hlsInstance) {
                    hlsInstance = new Hls();
                    hlsInstance.loadSource(videoUrl);
                    hlsInstance.attachMedia(player);
                    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
                    hlsInstance.on(Hls.Events.ERROR, (evt, d) => {
                        if (d.fatal) {
                            resText.textContent = 'Unable to stream directly. Please click "Download Video" above to save the file.';
                            resText.style.color = '#e74c3c';
                        }
                    });
                } else {
                    resText.textContent = 'Unable to stream directly. Please click "Download Video" above to save the file.';
                    resText.style.color = '#e74c3c';
                }
            });
        }
    }

    initPlayer();

    // --- HLS Client-Side Fragmented MP4 Assembler ---

    async function downloadHlsVideo(playlistUrl, filename, onProgress) {
        // 1. Fetch playlist
        const res = await fetch(playlistUrl);
        const text = await res.text();

        let variantUrl = playlistUrl;
        // Check if master playlist containing multiple stream levels
        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n').map(l => l.trim());
            let bestBw = -1;
            let bestUri = null;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                    const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
                    const nextUri = lines[i + 1];
                    if (nextUri && !nextUri.startsWith('#')) {
                        if (bw > bestBw || !bestUri) {
                            bestBw = bw;
                            bestUri = nextUri;
                        }
                    }
                }
            }
            if (bestUri) {
                variantUrl = new URL(bestUri, playlistUrl).href;
            }
        }

        // 2. Fetch chosen quality variant playlist
        const variantRes = await fetch(variantUrl);
        const variantText = await variantRes.text();
        const vLines = variantText.split('\n').map(l => l.trim());

        const mapLine = vLines.find(l => l.startsWith('#EXT-X-MAP:URI='));
        if (!mapLine) {
            throw new Error('Playlist missing fMP4 initialization segment');
        }
        const initMatch = mapLine.match(/URI=["']?([^"']+)["']?/);
        const initUrl = new URL(initMatch[1], variantUrl).href;

        const segUrls = vLines
            .filter(l => l && !l.startsWith('#'))
            .map(l => new URL(l, variantUrl).href);

        onProgress(0, segUrls.length + 1);

        // 3. Fetch initialization segment (contains ftyp + moov headers)
        const initRes = await fetch(initUrl);
        const initBuf = await initRes.arrayBuffer();
        const buffers = [initBuf];
        onProgress(1, segUrls.length + 1);

        // 4. Fetch all media segments (contains moof + mdat fragments)
        for (let i = 0; i < segUrls.length; i++) {
            const segRes = await fetch(segUrls[i]);
            const segBuf = await segRes.arrayBuffer();
            buffers.push(segBuf);
            onProgress(i + 2, segUrls.length + 1);
        }

        // 5. Combine buffers into a unified MP4 file
        const blob = new Blob(buffers, { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(blobUrl);
        }, 15000);
    }

    function restoreDlBtn() {
        dlBtn.disabled = false;
        dlBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Video
        `;
    }

    dlBtn.addEventListener('click', () => {
        const idMatch = videoUrl.match(/\/([a-zA-Z0-9_\-]+)\.mp4/i) || videoUrl.match(/\/(\d+_[^/?]+)/) || videoUrl.match(/\/vid\/(?:pl\/)?(?:v\d+\/)?([a-zA-Z0-9_\-]+)/);
        const filename = idMatch ? `LinkedIn_${idMatch[1]}.mp4` : `LinkedIn_Video_${Date.now()}.mp4`;

        if (isHls) {
            dlBtn.disabled = true;
            dlBtn.textContent = 'Preparing download...';

            downloadHlsVideo(videoUrl, filename, (curr, total) => {
                const pct = Math.round((curr / total) * 100);
                dlBtn.textContent = `Downloading ${pct}%...`;
            }).then(() => {
                dlBtn.textContent = 'Download Complete!';
                setTimeout(restoreDlBtn, 2500);
            }).catch((err) => {
                console.warn('HLS client-side assembly fallback:', err);
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: videoUrl,
                    filename: filename
                }, () => {
                    dlBtn.textContent = 'Download Started';
                    setTimeout(restoreDlBtn, 2500);
                });
            });
        } else {
            chrome.runtime.sendMessage({
                action: 'downloadMedia',
                url: videoUrl,
                filename: filename
            }, (response) => {
                if (response && response.success) {
                    dlBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Download Started
                    `;
                    setTimeout(restoreDlBtn, 2500);
                }
            });
        }
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(videoUrl).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy Link
                `;
            }, 1800);
        });
    });
})();
