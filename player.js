// player.js
// Universal in-browser media player & direct downloader for Toystaller.
// Supports direct MP4/WebM streams, HLS adaptive streams via Hls.js & client-side fMP4 assembly,
// and high-res image viewing with Referer/Origin headers intact.

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('url');
    const mediaId = params.get('id');
    const platformParam = (params.get('platform') || '').toLowerCase();

    const videoPlayer = document.getElementById('videoPlayer');
    const audioPlayer = document.getElementById('audioPlayer');
    const imageViewer = document.getElementById('imageViewer');
    const dlBtn = document.getElementById('dlBtn');
    const dlMutedBtn = document.getElementById('dlMutedBtn');
    const dlAudioBtn = document.getElementById('dlAudioBtn');
    const copyBtn = document.getElementById('copyBtn');
    const copyMutedBtn = document.getElementById('copyMutedBtn');
    const copyAudioBtn = document.getElementById('copyAudioBtn');
    const resText = document.getElementById('resolutionText');
    const formatText = document.getElementById('formatText');
    const shortcutsText = document.getElementById('shortcutsText');
    const brandBadge = document.getElementById('brandBadge');

    let activeDownloadUrl = rawUrl ? rawUrl.split('#')[0] : null;
    let activeAudioUrl = params.get('audioUrl') ? params.get('audioUrl').split('#')[0] : null;
    let activeMutedUrl = params.get('mutedUrl') ? params.get('mutedUrl').split('#')[0] : null;
    let activeFilename = `Toystaller_Media_${Date.now()}`;
    let activeAudioFilename = `Toystaller_Audio_${Date.now()}.mp3`;
    let isVideoMode = true;
    let isHls = false;
    let hlsInstance = null;

    // Platform theme & badge setup (Global Player)
    function setupBranding(detectedPlatform) {
        document.title = 'Toystaller - Media Player';
        if (brandBadge) {
            brandBadge.textContent = 'Global Player';
            brandBadge.style.background = '#4facfe';
            brandBadge.style.color = '#fff';
        }

        const p = (detectedPlatform || platformParam || '').toLowerCase();
        if (p.includes('linkedin') || (activeDownloadUrl && activeDownloadUrl.includes('licdn.com'))) {
            if (dlBtn) dlBtn.style.background = '#0a66c2';
        } else if (p.includes('facebook') || (activeDownloadUrl && (activeDownloadUrl.includes('fbcdn.net') || activeDownloadUrl.includes('fbsbx.com')))) {
            if (dlBtn) dlBtn.style.background = '#1877f2';
        } else if (p.includes('whatsapp') || (activeDownloadUrl && (activeDownloadUrl.includes('whatsapp.net') || activeDownloadUrl.includes('whatsapp.com')))) {
            if (dlBtn) {
                dlBtn.style.background = '#25D366';
                dlBtn.style.color = '#111b21';
            }
        } else if (p.includes('instagram') || (activeDownloadUrl && activeDownloadUrl.includes('cdninstagram.com'))) {
            if (dlBtn) dlBtn.style.background = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)';
        }
    }

    function showError(msg) {
        document.body.innerHTML = `
            <div style="color:#e4e6eb;font-family:sans-serif;text-align:center;margin-top:25vh;padding:20px;">
                <h2 style="font-size:22px;color:#ef4444;">Unable to Load Media</h2>
                <p style="margin-top:12px;color:#8a8d91;font-size:14px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.6;">
                    ${msg || 'Please close this tab and click the download button on the media element again.'}
                </p>
            </div>
        `;
    }

    if (!rawUrl && !mediaId) {
        showError('No media URL or session specified.');
        return;
    }

    // Determine media type
    function detectIsVideo(url) {
        if (!url) return true;
        const lower = url.toLowerCase();
        if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('.gif') || lower.includes('.svg')) {
            return false;
        }
        return true;
    }

    // --- HLS Client-Side Fragmented MP4 Assembler ---
    async function downloadHlsVideo(playlistUrl, filename, onProgress) {
        const masterRes = await fetch(playlistUrl);
        const masterText = await masterRes.text();

        let variantUrl = playlistUrl;
        if (masterText.includes('#EXT-X-STREAM-INF')) {
            const lines = masterText.split('\n').map(l => l.trim());
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

        const initRes = await fetch(initUrl);
        const initBuf = await initRes.arrayBuffer();
        const buffers = [initBuf];
        onProgress(1, segUrls.length + 1);

        for (let i = 0; i < segUrls.length; i++) {
            const segRes = await fetch(segUrls[i]);
            const segBuf = await segRes.arrayBuffer();
            buffers.push(segBuf);
            onProgress(i + 2, segUrls.length + 1);
        }

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

    // --- Chunked Range Downloader for Large / Long Media (Bypasses 500MB rate limits) ---
    async function downloadMediaWithProgress(url, filename, onProgress) {
        let totalSize = 0;
        let supportsRange = false;
        try {
            const probeRes = await fetch(url, {
                headers: { 'Range': 'bytes=0-0' }
            });
            if (probeRes.status === 206) {
                supportsRange = true;
                const cr = probeRes.headers.get('Content-Range');
                if (cr) {
                    const m = cr.match(/\/(\d+)/);
                    if (m) totalSize = parseInt(m[1], 10);
                }
            }
        } catch (e) {
            console.warn("Probe range check failed:", e);
        }

        // If file is small (< 80MB) or server doesn't support Range, use background download dispatcher
        if (!supportsRange || totalSize < 80 * 1024 * 1024) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: url,
                    filename: filename
                }, (response) => {
                    if (response && response.success) resolve();
                    else reject(new Error((response && response.error) || 'Download failed'));
                });
            });
        }

        // For large media (> 80MB, e.g. 754MB 1.23h Facebook video):
        // Download via 50MB Range chunks to prevent network drops and CDN aborts
        const CHUNK_SIZE = 50 * 1024 * 1024;
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

        let fileWritable = null;
        if (window.showSaveFilePicker) {
            try {
                const ext = filename.split('.').pop() || 'mp4';
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'Media File',
                        accept: { [`video/${ext}`]: [`.${ext}`] }
                    }]
                });
                fileWritable = await handle.createWritable();
            } catch (err) {
                console.log("Picker cancelled or unsupported, fallback to memory buffer:", err);
            }
        }

        const buffers = fileWritable ? null : [];
        let downloadedBytes = 0;

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min((i + 1) * CHUNK_SIZE - 1, totalSize - 1);

            if (onProgress) onProgress(downloadedBytes, totalSize);

            const chunkRes = await fetch(url, {
                headers: { 'Range': `bytes=${start}-${end}` }
            });

            if (!chunkRes.ok && chunkRes.status !== 206) {
                throw new Error(`Chunk download failed with status ${chunkRes.status}`);
            }

            const chunkBuf = await chunkRes.arrayBuffer();
            if (fileWritable) {
                await fileWritable.write(chunkBuf);
            } else {
                buffers.push(chunkBuf);
            }

            downloadedBytes += chunkBuf.byteLength;
            if (onProgress) onProgress(downloadedBytes, totalSize);
        }

        if (fileWritable) {
            await fileWritable.close();
            return;
        }

        const mime = filename.endsWith('.mp3') ? 'audio/mp3' : 'video/mp4';
        const blob = new Blob(buffers, { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(blobUrl);
        }, 30000);
    }

    function restoreDlBtn() {
        dlBtn.disabled = false;
        dlBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            ${isVideoMode ? 'Download Video' : 'Download Image'}
        `;
    }

    function setupAudioControls(audioUrl, detectedPlatform) {
        if (!audioUrl) return;
        activeAudioUrl = audioUrl.split('#')[0];
        const base = (detectedPlatform || platformParam || 'Toystaller').replace(/[^a-zA-Z0-9]/g, '_');
        activeAudioFilename = `${base}_Audio_${Date.now()}.mp3`;

        if (dlAudioBtn) dlAudioBtn.style.display = 'inline-flex';
        if (copyAudioBtn) copyAudioBtn.style.display = 'inline-flex';

        const isSeparateVideoStream = activeAudioUrl && activeDownloadUrl && (
            activeDownloadUrl.includes('stream_type=dash') ||
            activeDownloadUrl.includes('/o1/v/') ||
            activeDownloadUrl.includes('mime=video') ||
            activeMutedUrl === activeDownloadUrl
        );

        if (audioPlayer) {
            audioPlayer.src = activeAudioUrl;
            audioPlayer.preload = 'auto';

            if (isSeparateVideoStream) {
                const syncAndPlay = () => {
                    audioPlayer.currentTime = videoPlayer.currentTime;
                    audioPlayer.volume = videoPlayer.volume;
                    audioPlayer.muted = videoPlayer.muted;
                    if (!videoPlayer.paused) {
                        audioPlayer.play().catch(e => {
                            console.warn("Audio play prevented:", e);
                        });
                    }
                };

                videoPlayer.addEventListener('play', syncAndPlay);
                videoPlayer.addEventListener('playing', syncAndPlay);
                videoPlayer.addEventListener('pause', () => audioPlayer.pause());
                videoPlayer.addEventListener('seeking', () => {
                    audioPlayer.currentTime = videoPlayer.currentTime;
                });
                videoPlayer.addEventListener('seeked', () => {
                    audioPlayer.currentTime = videoPlayer.currentTime;
                    if (!videoPlayer.paused) audioPlayer.play().catch(() => {});
                });
                videoPlayer.addEventListener('volumechange', () => {
                    audioPlayer.volume = videoPlayer.volume;
                    audioPlayer.muted = videoPlayer.muted;
                });
                videoPlayer.addEventListener('timeupdate', () => {
                    if (Math.abs(audioPlayer.currentTime - videoPlayer.currentTime) > 0.25) {
                        audioPlayer.currentTime = videoPlayer.currentTime;
                    }
                });

                // Unlock audio on first user click or keypress in player tab
                const unlockAudio = () => {
                    if (!videoPlayer.paused) syncAndPlay();
                };
                window.addEventListener('click', unlockAudio, { once: true });
                window.addEventListener('keydown', unlockAudio, { once: true });

                if (!videoPlayer.paused) {
                    syncAndPlay();
                }
            }
        }
    }

    function setupMediaDisplay(sourceUrl, isVideo, filename, detectedPlatform) {
        activeDownloadUrl = sourceUrl;
        isVideoMode = isVideo;

        setupBranding(detectedPlatform);

        if (filename) {
            activeFilename = filename;
        } else {
            const idMatch = sourceUrl.match(/\/([a-zA-Z0-9_\-]+)\.(mp4|jpg|jpeg|png|webp)/i) || 
                            sourceUrl.match(/\/(\d+_[^/?]+)/);
            const ext = isVideo ? 'mp4' : 'jpg';
            const base = (detectedPlatform || 'Toystaller').replace(/[^a-zA-Z0-9]/g, '_');
            activeFilename = idMatch ? `${base}_${idMatch[1]}.${ext}` : `${base}_${isVideo ? 'Video' : 'Image'}_${Date.now()}.${ext}`;
        }

        // Guarantee proper file extension (e.g. for LinkedIn hashed CDN URLs)
        const expectedExt = isVideo ? '.mp4' : '.jpg';
        if (!activeFilename.toLowerCase().endsWith(expectedExt) && 
            !activeFilename.toLowerCase().endsWith('.jpeg') && 
            !activeFilename.toLowerCase().endsWith('.png') && 
            !activeFilename.toLowerCase().endsWith('.webp')) {
            activeFilename += expectedExt;
        }

        if (activeAudioUrl) {
            setupAudioControls(activeAudioUrl, detectedPlatform);
        }

        if (isVideo) {
            videoPlayer.style.display = 'block';
            imageViewer.style.display = 'none';
            if (shortcutsText) shortcutsText.style.display = 'inline-flex';
            
            const isDash = sourceUrl && sourceUrl.includes('stream_type=dash');
            const isSeparate = activeAudioUrl && (isDash || sourceUrl.includes('/o1/v/') || activeMutedUrl === sourceUrl);
            if (formatText) {
                if (isSeparate) {
                    formatText.textContent = 'Direct DASH Stream (Synced Audio + Video)';
                } else {
                    formatText.textContent = 'Direct Master Audio + Video';
                }
            }

            // Always display Audio options for video mode (empowers editors and users to extract/copy audio)
            if (dlAudioBtn) dlAudioBtn.style.display = 'inline-flex';
            if (copyAudioBtn) copyAudioBtn.style.display = 'inline-flex';

            // Always display Muted/Video stream options for video mode
            if (dlMutedBtn) dlMutedBtn.style.display = 'inline-flex';
            if (copyMutedBtn) copyMutedBtn.style.display = 'inline-flex';

            dlBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download Video
            `;

            const cleanUrl = sourceUrl.split('#')[0];
            isHls = cleanUrl.includes('/pl/') || cleanUrl.includes('.m3u8') || cleanUrl.includes('format=m3u8');

            if (isHls && window.Hls && Hls.isSupported()) {
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 90
                });

                hlsInstance.loadSource(cleanUrl);
                hlsInstance.attachMedia(videoPlayer);

                hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                    // Always lock to the absolute highest quality stream available
                    if (hlsInstance.levels && hlsInstance.levels.length > 0) {
                        hlsInstance.currentLevel = hlsInstance.levels.length - 1;
                        const best = hlsInstance.levels[hlsInstance.levels.length - 1];
                        resText.textContent = `${best.width || 'HD'} x ${best.height || '1080'} • Master HD Video`;
                    }
                    videoPlayer.play().catch(() => {});
                });

                hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                    if (hlsInstance.levels && hlsInstance.levels[data.level]) {
                        const l = hlsInstance.levels[data.level];
                        resText.textContent = `${l.width} x ${l.height} • HD Video`;
                    }
                });

                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                hlsInstance.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hlsInstance.recoverMediaError();
                                break;
                            default:
                                resText.textContent = 'Unable to stream directly. Please click "Download Video" above.';
                                resText.style.color = '#ef4444';
                                break;
                        }
                    }
                });
            } else {
                videoPlayer.src = cleanUrl;
                videoPlayer.play().catch(() => {
                    videoPlayer.muted = true;
                    videoPlayer.play().catch(() => {});
                });

                const unmuteHandler = () => {
                    if (videoPlayer && videoPlayer.muted && isVideoMode) {
                        videoPlayer.muted = false;
                    }
                };
                window.addEventListener('click', unmuteHandler, { once: true });
                window.addEventListener('keydown', unmuteHandler, { once: true });

                videoPlayer.addEventListener('loadedmetadata', () => {
                    if (videoPlayer.videoWidth && videoPlayer.videoHeight) {
                        resText.textContent = `${videoPlayer.videoWidth} x ${videoPlayer.videoHeight} • HD MP4`;
                    }
                });

                videoPlayer.addEventListener('error', () => {
                    if (window.Hls && Hls.isSupported() && !hlsInstance && (cleanUrl.includes('.m3u8') || cleanUrl.includes('manifest'))) {
                        hlsInstance = new Hls();
                        hlsInstance.loadSource(cleanUrl);
                        hlsInstance.attachMedia(videoPlayer);
                        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => videoPlayer.play().catch(() => {}));
                    } else {
                        console.warn("Toystaller Player: Direct preview blocked or pending:", cleanUrl);
                        if (cleanUrl && !cleanUrl.startsWith('blob:') && !cleanUrl.startsWith('data:')) {
                            window.location.replace(cleanUrl);
                        } else {
                            resText.textContent = 'Preview restricted by host. Click "Download Video" above to save the master MP4 directly.';
                            resText.style.color = '#ef4444';
                        }
                    }
                });
            }
        } else {
            // Image Mode
            videoPlayer.style.display = 'none';
            imageViewer.style.display = 'block';
            if (shortcutsText) shortcutsText.style.display = 'none';
            if (formatText) formatText.textContent = 'High-Resolution Image';

            if (dlAudioBtn) dlAudioBtn.style.display = 'none';
            if (copyAudioBtn) copyAudioBtn.style.display = 'none';
            if (dlMutedBtn) dlMutedBtn.style.display = 'none';
            if (copyMutedBtn) copyMutedBtn.style.display = 'none';

            dlBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download Image
            `;

            imageViewer.src = sourceUrl;
            imageViewer.onload = () => {
                if (imageViewer.naturalWidth && imageViewer.naturalHeight) {
                    resText.textContent = `${imageViewer.naturalWidth} x ${imageViewer.naturalHeight} • Master Photo`;
                }
            };
            imageViewer.onerror = () => {
                console.warn("Toystaller Player: Host blocked embedding this image:", sourceUrl);
                resText.textContent = 'Preview restricted by host headers. Click "Download Image" to save directly.';
                resText.style.color = '#ef4444';
            };
        }
    }

    // Initialize with direct URL or cached session ID
    if (rawUrl) {
        const isVid = detectIsVideo(rawUrl);
        setupMediaDisplay(rawUrl, isVid, null, platformParam);
    } else if (mediaId) {
        chrome.runtime.sendMessage({ action: 'getPlayerMedia', id: mediaId }, (response) => {
            if (response && (response.url || response.dataUrl)) {
                setupMediaDisplay(response.dataUrl || response.url, response.isVideo !== false, response.filename, response.platform || 'WhatsApp');
            } else {
                showError('Media session expired or not found. Please click the button on the media element again.');
            }
        });
    }

    // Download Button handler
    dlBtn.addEventListener('click', () => {
        if (!activeDownloadUrl) return;

        dlBtn.disabled = true;

        if (isHls) {
            dlBtn.textContent = 'Preparing download...';

            downloadHlsVideo(activeDownloadUrl, activeFilename, (curr, total) => {
                const pct = Math.round((curr / total) * 100);
                dlBtn.textContent = `Downloading ${pct}%...`;
            }).then(() => {
                dlBtn.textContent = 'Download Complete!';
                setTimeout(restoreDlBtn, 2500);
            }).catch((err) => {
                console.warn('HLS client assembly fallback:', err);
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: activeDownloadUrl,
                    filename: activeFilename
                }, () => {
                    dlBtn.textContent = 'Download Started';
                    setTimeout(restoreDlBtn, 2500);
                });
            });
        } else {
            dlBtn.textContent = 'Starting download...';
            downloadMediaWithProgress(activeDownloadUrl, activeFilename, (curr, total) => {
                const pct = total > 0 ? Math.round((curr / total) * 100) : 0;
                dlBtn.textContent = `Downloading ${pct}%...`;
            }).then(() => {
                dlBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Download Complete!
                `;
                setTimeout(restoreDlBtn, 2500);

                // If this is a separate DASH video-only stream, also download accompanying audio
                if (activeAudioUrl && (activeDownloadUrl.includes('stream_type=dash') || activeDownloadUrl.includes('/o1/v/'))) {
                    downloadMediaWithProgress(activeAudioUrl, activeAudioFilename, () => {});
                }
            }).catch((err) => {
                console.warn("Direct download fallback:", err);
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: activeDownloadUrl,
                    filename: activeFilename
                }, () => {
                    dlBtn.textContent = 'Download Started';
                    setTimeout(restoreDlBtn, 2500);
                });
            });
        }
    });

    // Copy Link handler
    copyBtn.addEventListener('click', () => {
        if (!activeDownloadUrl) return;
        navigator.clipboard.writeText(activeDownloadUrl).then(() => {
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

    // Copy Muted Video Link handler
    if (copyMutedBtn) {
        copyMutedBtn.addEventListener('click', () => {
            const targetMuted = activeMutedUrl || activeDownloadUrl;
            if (!targetMuted) return;
            navigator.clipboard.writeText(targetMuted).then(() => {
                copyMutedBtn.textContent = 'Muted Copied!';
                setTimeout(() => {
                    copyMutedBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                        Copy Muted
                    `;
                }, 1800);
            });
        });
    }

    // Download Muted Video handler
    if (dlMutedBtn) {
        dlMutedBtn.addEventListener('click', () => {
            const targetMuted = activeMutedUrl || activeDownloadUrl;
            if (!targetMuted) return;
            const ext = 'mp4';
            const base = (platformParam || 'Toystaller').replace(/[^a-zA-Z0-9]/g, '_');
            const dlFilename = `${base}_Muted_${Date.now()}.${ext}`;

            dlMutedBtn.textContent = 'Downloading Muted...';
            downloadMediaWithProgress(targetMuted, dlFilename, (curr, total) => {
                const pct = total > 0 ? Math.round((curr / total) * 100) : 0;
                dlMutedBtn.textContent = `Muted ${pct}%...`;
            }).then(() => {
                dlMutedBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Muted Complete!
                `;
                setTimeout(() => {
                    dlMutedBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                        Download Muted
                    `;
                }, 2500);
            }).catch(() => {
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: targetMuted,
                    filename: dlFilename
                }, () => {
                    dlMutedBtn.textContent = 'Muted Started';
                    setTimeout(() => {
                        dlMutedBtn.innerHTML = `
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                            Download Muted
                        `;
                    }, 2500);
                });
            });
        });
    }

    // Copy Audio handler
    if (copyAudioBtn) {
        copyAudioBtn.addEventListener('click', () => {
            const targetAudio = activeAudioUrl || activeDownloadUrl;
            if (!targetAudio) return;
            navigator.clipboard.writeText(targetAudio).then(() => {
                copyAudioBtn.textContent = 'Audio Copied!';
                setTimeout(() => {
                    copyAudioBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                        Copy Audio
                    `;
                }, 1800);
            });
        });
    }

    // Download Audio handler
    if (dlAudioBtn) {
        dlAudioBtn.addEventListener('click', () => {
            const targetAudio = activeAudioUrl || activeDownloadUrl;
            if (!targetAudio) return;
            const ext = activeAudioUrl ? 'mp3' : 'mp4';
            const base = (platformParam || 'Toystaller').replace(/[^a-zA-Z0-9]/g, '_');
            const dlFilename = activeAudioFilename || `${base}_Audio_${Date.now()}.${ext}`;

            dlAudioBtn.textContent = 'Downloading Audio...';
            downloadMediaWithProgress(targetAudio, dlFilename, (curr, total) => {
                const pct = total > 0 ? Math.round((curr / total) * 100) : 0;
                dlAudioBtn.textContent = `Audio ${pct}%...`;
            }).then(() => {
                dlAudioBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Audio Complete!
                `;
                setTimeout(() => {
                    dlAudioBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                        Download Audio
                    `;
                }, 2500);
            }).catch(() => {
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: targetAudio,
                    filename: dlFilename
                }, () => {
                    dlAudioBtn.textContent = 'Audio Started';
                    setTimeout(() => {
                        dlAudioBtn.innerHTML = `
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            Download Audio
                        `;
                    }, 2500);
                });
            });
        });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space' && isVideoMode) {
            e.preventDefault();
            if (videoPlayer.paused) {
                videoPlayer.play();
            } else {
                videoPlayer.pause();
            }
        } else if (e.key === 'm' || e.key === 'M') {
            if (isVideoMode) {
                videoPlayer.muted = !videoPlayer.muted;
            }
        } else if (e.key === 'f' || e.key === 'F') {
            const targetEl = isVideoMode ? videoPlayer : imageViewer;
            if (!document.fullscreenElement) {
                if (targetEl.requestFullscreen) targetEl.requestFullscreen().catch(() => {});
            } else {
                if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
            }
        }
    });
})();

