// core/content_core.js
// Toystaller v1.0 (WhatsApp Edition) — Specialized Media Extractor, Viewer & Downloader.
// Supports: Chat Conversation Images & Videos, Status/Stories Viewer, Fullscreen Media Lightbox, and Contact Info Drawer.

const pageInterceptedVideoUrls = new Set();
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'toystaller_video_urls' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(url => pageInterceptedVideoUrls.add(url));
    }
});

function safeSendMessage(msg, callback) {
    try {
        if (!chrome.runtime || !chrome.runtime.id) return;
        chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Toystaller: extension context invalidated, please reload page.');
                return;
            }
            if (callback) callback(response);
        });
    } catch (e) {
        console.warn('Toystaller: extension context invalidated, please reload page.');
    }
}

// Request media operations (download or base64 read for player tab) from the MAIN page world
function requestMediaFromMain(url, action = 'download', isVideo = false, filename = null) {
    return new Promise((resolve) => {
        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        let resolved = false;
        const handler = (e) => {
            if (!e.data || e.data.type !== 'toystaller_main_media_response') return;
            if (e.data.requestId !== requestId) return;
            if (resolved) return;
            resolved = true;
            window.removeEventListener('message', handler);
            resolve(e.data);
        };
        window.addEventListener('message', handler);

        // Timeout fallback after 3000ms
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            window.removeEventListener('message', handler);
            resolve({ success: false, timeout: true });
        }, 3000);

        // Post request to MAIN page world (page_interceptor.js)
        window.postMessage({
            type: 'toystaller_main_media_request',
            action: action,
            url: url,
            isVideo: isVideo,
            filename: filename,
            requestId: requestId
        }, '*');
    });
}

// Direct download helper (executes via main-world anchor click or background fallback)
async function downloadMedia(url, isVideo = false) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = isVideo ? 'mp4' : 'jpg';
    const filename = `whatsapp_${isVideo ? 'video' : 'image'}_${timestamp}.${ext}`;

    // 1. Primary: trigger direct download from main world
    const res = await requestMediaFromMain(url, 'download', isVideo, filename);
    if (res && res.success) {
        return true;
    }

    // 2. Secondary fallback: in-page anchor click
    try {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 2000);
        return true;
    } catch (e) {
        console.warn('Toystaller: Direct anchor click fallback failed:', e);
    }

    // 3. Tertiary fallback: background service worker download
    safeSendMessage({ action: 'downloadMedia', url: url, filename: filename });
    return true;
}

// Safely opens the image or video in the dedicated viewer/player tab
async function openMediaTab(url, isVideo = false) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = isVideo ? 'mp4' : 'jpg';
    const filename = `whatsapp_${isVideo ? 'video' : 'image'}_${timestamp}.${ext}`;

    // If it's a standard HTTP/HTTPS non-blob URL, open via background directly
    if (url && !url.startsWith('blob:') && !url.startsWith('data:')) {
        safeSendMessage({ 
            action: 'createPlayerTab', 
            url: url, 
            isVideo: isVideo, 
            filename: filename 
        }, (response) => {
            if (!response || !response.success) {
                safeSendMessage({ action: 'openInNewTab', url: url, isVideo: isVideo });
            }
        });
        return;
    }

    // For decrypted blob URLs: request Base64 data from main world
    const res = await requestMediaFromMain(url, 'open', isVideo, filename);
    if (res && res.dataUrl) {
        safeSendMessage({
            action: 'createPlayerTab',
            dataUrl: res.dataUrl,
            mimeType: res.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
            isVideo: isVideo,
            filename: filename
        }, (response) => {
            if (!response || !response.success) {
                // If tab opening fails, trigger direct download so user still gets media
                downloadMedia(url, isVideo);
            }
        });
        return;
    }

    // Fallback: If blob could not be transferred to tab, download directly
    console.warn('Toystaller: Could not open in new tab, triggering direct download fallback.');
    downloadMedia(url, isVideo);
}

function isRawMediaTab() {
    if (document.contentType && (document.contentType.startsWith('video/') || document.contentType.startsWith('image/'))) {
        return true;
    }
    if (document.body && document.body.children.length === 1) {
        const child = document.body.firstElementChild;
        if (child && (child.tagName === 'VIDEO' || child.tagName === 'IMG')) {
            return true;
        }
    }
    return false;
}

function getActivePlatform() {
    return window.ToystallerActivePlatform || (window.ToystallerPlatforms && window.ToystallerPlatforms['whatsapp']) || {
        name: 'whatsapp',
        hasActiveModal() { return false; },
        isInsideModal() { return false; },
        isThumbnail() { return false; },
        getButtonScale() { return 1; },
        filterBackgroundUrls(candidates) { return candidates; },
        useDirectDownload: false,
        isInternalUrl() { return true; }
    };
}

// Locates the active visible status media element (video or image)
function getActiveStatusMedia() {
    const statusViewer = document.querySelector(`
        [data-animate-status-v3="true"],
        div[data-testid="status-v3-main"],
        div[data-testid="status-viewer"],
        div[data-testid="media-viewer"],
        div[aria-label*="Status" i],
        div[aria-label*="Story" i],
        div[role="dialog"]
    `);

    if (statusViewer) {
        const video = statusViewer.querySelector('video');
        if (video && (video.currentSrc || video.src)) return video;

        const imgs = Array.from(statusViewer.querySelectorAll('img'));
        const validImgs = imgs.filter(img => {
            const rect = img.getBoundingClientRect();
            return rect.width >= 100 && rect.height >= 100 && !img.src.includes('avatar') && !img.src.includes('profile');
        });
        if (validImgs.length > 0) {
            return validImgs.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
        }
    }

    const videos = Array.from(document.querySelectorAll('video'));
    const activeVideo = videos.find(v => {
        const rect = v.getBoundingClientRect();
        return rect.width > 150 && rect.height > 150 && (v.currentSrc || v.src);
    });
    if (activeVideo) return activeVideo;

    return null;
}

function getHighResImageUrl(media) {
    if (!media) media = getActiveStatusMedia();
    if (!media) return null;

    let finalUrl = media.currentSrc || media.src;

    if (media.srcset) {
        const srcsetItems = media.srcset.split(',').map(s => s.trim().split(' '));
        if (srcsetItems.length > 0) {
            const largest = srcsetItems.sort((a, b) => {
                const wA = parseInt(a[1] || '0', 10);
                const wB = parseInt(b[1] || '0', 10);
                return wB - wA;
            })[0];
            if (largest && largest[0]) {
                finalUrl = largest[0];
            }
        }
    }

    if (!finalUrl && media.parentElement) {
        const nestedImg = media.parentElement.querySelector('img');
        if (nestedImg) finalUrl = nestedImg.currentSrc || nestedImg.src;
    }

    if (!finalUrl) {
        const statusMedia = getActiveStatusMedia();
        if (statusMedia) finalUrl = statusMedia.currentSrc || statusMedia.src;
    }

    return finalUrl;
}

function getVideoUrl(media) {
    if (!media) media = getActiveStatusMedia();
    if (!media) return '';

    let url = media.currentSrc || media.src || '';
    if (!url && media.querySelector) {
        const source = media.querySelector('source');
        if (source && source.src) url = source.src;
    }
    if (!url) {
        url = media.getAttribute('src') || '';
    }
    if (!url && media.parentElement) {
        const nested = media.parentElement.querySelector('video');
        if (nested && (nested.currentSrc || nested.src)) {
            url = nested.currentSrc || nested.src;
        }
    }
    if (!url) {
        const statusMedia = getActiveStatusMedia();
        if (statusMedia && statusMedia.tagName.toLowerCase() === 'video') {
            url = statusMedia.currentSrc || statusMedia.src || '';
        }
    }
    return url;
}

function getResolvedMediaUrl(media, isVideo) {
    if (isVideo) {
        return getVideoUrl(media);
    }
    return getHighResImageUrl(media);
}

// Active polling and event listener for media that is still buffering
function resolveMediaWithWait(media, isVideo, timeoutMs = 2500) {
    return new Promise((resolve) => {
        let url = getResolvedMediaUrl(media, isVideo);
        if (url) return resolve(url);

        const startTime = Date.now();
        const interval = setInterval(() => {
            url = getResolvedMediaUrl(media, isVideo);
            if (url) {
                clearInterval(interval);
                return resolve(url);
            }
            if (Date.now() - startTime >= timeoutMs) {
                clearInterval(interval);
                return resolve(getResolvedMediaUrl(media, isVideo));
            }
        }, 100);

        if (media && media.addEventListener) {
            const onLoaded = () => {
                cleanup();
                resolve(getResolvedMediaUrl(media, isVideo));
            };
            const cleanup = () => {
                media.removeEventListener('loadeddata', onLoaded);
                media.removeEventListener('canplay', onLoaded);
            };
            media.addEventListener('loadeddata', onLoaded, { once: true });
            media.addEventListener('canplay', onLoaded, { once: true });
        }
    });
}

function injectDownloadButtons() {
    if (isRawMediaTab()) return;

    const platform = getActivePlatform();
    const hasModal = platform.hasActiveModal();

    if (window.magicOverlayManager) {
        window.magicOverlayManager.updateAllPositions();
    }

    const mediaElements = document.querySelectorAll('video, img');

    mediaElements.forEach(media => {
        if (platform.isThumbnail(media)) return;

        if (hasModal && !platform.isInsideModal(media)) return;

        if (window.magicOverlayManager && !window.magicOverlayManager.overlays.has(media)) {
            const isVideo = media.tagName.toLowerCase() === 'video';
            const scale = platform.getButtonScale(media);

            const createButtonsFn = () => {
                const buttons = [];

                const makeBtnStyle = (bgColor) => `
                    padding: ${Math.round(7 * scale)}px;
                    background-color: ${bgColor};
                    color: white;
                    border: 1.5px solid rgba(255,255,255,0.85);
                    border-radius: 7px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: auto;
                    opacity: 0.65;
                    transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.45);
                    transform: scale(${scale});
                    transform-origin: center;
                    margin: 0 3px;
                `;

                const iconSize = Math.round(16 * scale);
                // Standard arrow SVG (matches Instagram & Facebook)
                const arrowSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                const spinnerSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: toystaller-spin 0.8s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"></circle></svg>`;
                const checkmarkSvg = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                if (!document.getElementById('toystaller-spin-style')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'toystaller-spin-style';
                    styleEl.textContent = `@keyframes toystaller-spin { 100% { transform: rotate(360deg); } }`;
                    (document.head || document.documentElement).appendChild(styleEl);
                }

                // --- Button 1: Blue Arrow Button (Open in New Tab / Player) ---
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open HD video in new tab' : 'Open photo in new tab';
                openBtn.innerHTML = arrowSvg;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                openBtn.addEventListener('mouseenter', () => {
                    openBtn.style.opacity = '1';
                    openBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
                });
                openBtn.addEventListener('mouseleave', () => {
                    openBtn.style.opacity = '0.65';
                    openBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                openBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    openBtn.innerHTML = spinnerSvg;
                    let url = await resolveMediaWithWait(media, isVideo, 2500);
                    await openMediaTab(url, isVideo);
                    setTimeout(() => { openBtn.innerHTML = arrowSvg; }, 700);
                });
                buttons.push(openBtn);

                // --- Button 2: Red Arrow Button (Direct Download to Computer) ---
                const imgBtn = document.createElement('button');
                imgBtn.className = 'magic-img-btn';
                imgBtn.title = isVideo ? 'Download video directly' : 'Download photo directly';
                imgBtn.innerHTML = arrowSvg;
                imgBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                imgBtn.addEventListener('mouseenter', () => {
                    imgBtn.style.opacity = '1';
                    imgBtn.style.backgroundColor = 'rgba(231, 76, 60, 0.95)';
                });
                imgBtn.addEventListener('mouseleave', () => {
                    imgBtn.style.opacity = '0.65';
                    imgBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                imgBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    imgBtn.innerHTML = spinnerSvg;
                    let url = await resolveMediaWithWait(media, isVideo, 2500);

                    const success = await downloadMedia(url, isVideo);

                    if (success) {
                        // Flash green checkmark on the button to confirm download
                        imgBtn.innerHTML = checkmarkSvg;
                        imgBtn.style.backgroundColor = '#128C7E';
                        setTimeout(() => {
                            imgBtn.innerHTML = arrowSvg;
                            imgBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                        }, 1400);
                    } else {
                        setTimeout(() => { imgBtn.innerHTML = arrowSvg; }, 600);
                    }
                });
                buttons.push(imgBtn);

                return buttons;
            };

            window.magicOverlayManager.addOverlay(media, createButtonsFn);
        }
    });
}

let injectScheduled = false;
function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
        injectScheduled = false;
        injectDownloadButtons();
    }, 120);
}

// Dashboard Overlay
let dashboardContainer = null;
function toggleDashboardOverlay() {
    if (dashboardContainer) {
        dashboardContainer.remove();
        dashboardContainer = null;
        return;
    }

    const platform = getActivePlatform();

    dashboardContainer = document.createElement('div');
    dashboardContainer.id = 'toystaller-dashboard-container';
    dashboardContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;

    const shadow = dashboardContainer.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>
            .dashboard {
                background: rgba(17, 27, 33, 0.95);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 16px;
                color: #e9edef;
                width: 280px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 8px;
                margin-bottom: 12px;
            }
            h2 { margin: 0; font-size: 14px; font-weight: 600; color: #fff; }
            .close-btn {
                background: transparent;
                border: none;
                color: #8696a0;
                font-size: 18px;
                cursor: pointer;
                transition: color 0.2s;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: 4px;
            }
            .close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
            .info-row {
                font-size: 12px;
                color: #8696a0;
                text-align: center;
                padding: 6px 0;
            }
            .specialization {
                margin-top: 8px;
                padding: 10px;
                background: rgba(255, 255, 255, 0.04);
                border-radius: 8px;
                font-size: 11px;
                line-height: 1.5;
                color: #d1d7db;
                border-left: 3px solid #25D366;
            }
        </style>

        <div class="dashboard">
            <div class="header">
                <h2>Toystaller ${platform.version || 'v1.0'} — WhatsApp Edition</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on ${window.location.hostname}
            </div>
            <div class="specialization">
                <strong>WhatsApp Downloader:</strong><br/>
                Download high-resolution images, videos, and status updates directly in high-quality new tabs or direct to disk.
            </div>
        </div>
    `;

    shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);
    document.body.appendChild(dashboardContainer);
}

// Background script listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'toggleDashboard') {
            toggleDashboardOverlay();
        }
    });
}

let toystallerBooted = false;

function bootToystaller(platformScripts = [], routerCode = null) {
    if (toystallerBooted) return;
    toystallerBooted = true;

    if (platformScripts && platformScripts.length > 0) {
        let currentScriptIdx = 0;
        const injectNext = () => {
            if (currentScriptIdx >= platformScripts.length) {
                if (routerCode) {
                    const routerScript = document.createElement('script');
                    routerScript.textContent = routerCode;
                    (document.head || document.documentElement).appendChild(routerScript);
                    routerScript.remove();
                }
                return;
            }
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(platformScripts[currentScriptIdx]);
            script.onload = () => {
                script.remove();
                currentScriptIdx++;
                injectNext();
            };
            (document.head || document.documentElement).appendChild(script);
        };
        injectNext();
    }

    injectDownloadButtons();
    setInterval(injectDownloadButtons, 1000);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

// Auto-boot if not already booted
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!toystallerBooted) bootToystaller();
    });
} else {
    setTimeout(() => {
        if (!toystallerBooted) bootToystaller();
    }, 100);
}
