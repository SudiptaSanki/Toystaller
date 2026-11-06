// player.js
// Anti-Redirect In-Browser HTML5 Player & Image Viewer for Toystaller: WhatsApp Edition
// Bypasses CDN 302 redirects by loading media natively inside an HTML5 <video> / <img> element with Referer/Origin rules.
// Supports direct CDN URLs (?url=...) and client-decrypted blob sessions (?id=...).

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('url');
    const mediaId = params.get('id');

    const videoPlayer = document.getElementById('videoPlayer');
    const imageViewer = document.getElementById('imageViewer');
    const dlBtn = document.getElementById('dlBtn');
    const copyBtn = document.getElementById('copyBtn');
    const resText = document.getElementById('resolutionText');
    const formatText = document.getElementById('formatText');
    const shortcutsText = document.getElementById('shortcutsText');

    let activeDownloadUrl = videoUrl;
    let activeFilename = `WhatsApp_Media_${Date.now()}`;
    let isVideoMode = true;

    function showError(msg) {
        document.body.innerHTML = `
            <div style="color:#e9edef;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;margin-top:25vh;padding:20px;">
                <h2 style="font-size:20px;color:#ef4444;">Unable to Load Media</h2>
                <p style="margin-top:12px;color:#8696a0;font-size:14px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.6;">
                    ${msg || 'Please close this tab, make sure the media has loaded or started playing on WhatsApp Web, and click the button again.'}
                </p>
            </div>
        `;
    }

    if (!videoUrl && !mediaId) {
        showError('No media link or session specified.');
        return;
    }

    function setupMediaDisplay(sourceUrl, isVideo, filename) {
        activeDownloadUrl = sourceUrl;
        isVideoMode = isVideo;

        if (filename) {
            activeFilename = filename;
        } else {
            const ext = isVideo ? 'mp4' : 'jpg';
            activeFilename = `WhatsApp_${isVideo ? 'Video' : 'Image'}_${Date.now()}.${ext}`;
        }

        if (isVideo) {
            document.title = 'Toystaller - WhatsApp Video Player';
            videoPlayer.style.display = 'block';
            imageViewer.style.display = 'none';
            if (shortcutsText) shortcutsText.style.display = 'inline-flex';
            if (formatText) formatText.textContent = 'Direct Master Audio + Video';

            dlBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download Video
            `;

            videoPlayer.src = sourceUrl;
            videoPlayer.play().catch(() => {});

            videoPlayer.addEventListener('loadedmetadata', () => {
                if (videoPlayer.videoWidth && videoPlayer.videoHeight) {
                    resText.textContent = `${videoPlayer.videoWidth} x ${videoPlayer.videoHeight} • HD MP4`;
                }
            });

            videoPlayer.addEventListener('error', () => {
                resText.textContent = 'Playback error. Click "Download Video" above to save the file.';
                resText.style.color = '#ef4444';
            });
        } else {
            document.title = 'Toystaller - WhatsApp Image Viewer';
            imageViewer.style.display = 'block';
            videoPlayer.style.display = 'none';
            if (shortcutsText) shortcutsText.style.display = 'none';
            if (formatText) formatText.textContent = 'Direct High-Resolution Photo';

            dlBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download Image
            `;

            imageViewer.src = sourceUrl;

            imageViewer.addEventListener('load', () => {
                if (imageViewer.naturalWidth && imageViewer.naturalHeight) {
                    resText.textContent = `${imageViewer.naturalWidth} x ${imageViewer.naturalHeight} • Full-Res Image`;
                }
            });

            imageViewer.addEventListener('error', () => {
                resText.textContent = 'Could not display image directly.';
                resText.style.color = '#ef4444';
            });
        }
    }

    if (videoUrl) {
        const lower = videoUrl.toLowerCase();
        const isVideo = lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.m4v') || lower.includes('mime=video') || lower.includes('/video/');
        setupMediaDisplay(videoUrl, isVideo);
    } else if (mediaId) {
        chrome.runtime.sendMessage({ action: 'getPlayerMedia', id: mediaId }, (response) => {
            if (chrome.runtime.lastError || !response) {
                // Secondary fallback check
                chrome.runtime.sendMessage({ action: 'getViewerMedia', id: mediaId }, (res2) => {
                    if (chrome.runtime.lastError || !res2) {
                        showError('Could not retrieve media session from WhatsApp Web. Please try again.');
                        return;
                    }
                    processSessionMedia(res2);
                });
                return;
            }
            processSessionMedia(response);
        });
    }

    function processSessionMedia(data) {
        const isVideo = data.isVideo !== undefined ? data.isVideo : true;
        const filename = data.filename || `WhatsApp_${isVideo ? 'Video' : 'Image'}_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;

        if (data.dataUrl) {
            // High-performance Base64 Data URL to Blob ObjectURL conversion
            fetch(data.dataUrl)
                .then(res => res.blob())
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    setupMediaDisplay(objectUrl, isVideo, filename);
                })
                .catch(() => {
                    // Direct dataUrl fallback
                    setupMediaDisplay(data.dataUrl, isVideo, filename);
                });
            return;
        }

        if (data.url) {
            setupMediaDisplay(data.url, isVideo, filename);
            return;
        }

        if (data.buffer) {
            try {
                const buffer = data.buffer instanceof ArrayBuffer
                    ? data.buffer
                    : (data.buffer.buffer || new Uint8Array(data.buffer).buffer);
                const blob = new Blob([buffer], { type: data.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg') });
                const objectUrl = URL.createObjectURL(blob);
                setupMediaDisplay(objectUrl, isVideo, filename);
            } catch (err) {
                console.error('Toystaller buffer decoding error:', err);
                showError('Error decoding media: ' + err.message);
            }
            return;
        }

        showError('No playable stream or image found in this session.');
    }

    // --- Action Button Handlers ---
    dlBtn.addEventListener('click', () => {
        if (!activeDownloadUrl) return;

        if (activeDownloadUrl.startsWith('blob:') || activeDownloadUrl.startsWith('data:')) {
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = activeDownloadUrl;
            a.download = activeFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 2000);
            animateDownloadBtn();
            return;
        }

        chrome.runtime.sendMessage({
            action: 'downloadMedia',
            url: activeDownloadUrl,
            filename: activeFilename
        }, (response) => {
            if (response && response.success) {
                animateDownloadBtn();
            } else {
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = activeDownloadUrl;
                a.download = activeFilename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 2000);
                animateDownloadBtn();
            }
        });
    });

    function animateDownloadBtn() {
        const originalText = dlBtn.innerHTML;
        dlBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Download Started
        `;
        dlBtn.style.background = '#128C7E';
        setTimeout(() => {
            dlBtn.innerHTML = originalText;
            dlBtn.style.background = '#25D366';
        }, 2200);
    }

    copyBtn.addEventListener('click', () => {
        const textToCopy = videoUrl || (activeDownloadUrl.startsWith('blob:') ? window.location.href : activeDownloadUrl);
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Copy Link
                `;
            }, 1800);
        }).catch(() => {});
    });

    // --- Keyboard Shortcuts for Video Player ---
    window.addEventListener('keydown', (e) => {
        if (!isVideoMode || !videoPlayer) return;
        const tag = (e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '');
        if (tag === 'input' || tag === 'textarea') return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (videoPlayer.paused) {
                videoPlayer.play();
            } else {
                videoPlayer.pause();
            }
        } else if (e.code === 'KeyM') {
            e.preventDefault();
            videoPlayer.muted = !videoPlayer.muted;
        } else if (e.code === 'KeyF') {
            e.preventDefault();
            if (!document.fullscreenElement) {
                videoPlayer.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + 5);
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
        }
    });
})();
