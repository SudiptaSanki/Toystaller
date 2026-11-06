// content_script.js
// Specialized Facebook Media Extractor & Button Injector.
// Supports: Watch, Reels, Stories, Theater Mode, News Feed Posts, Groups, Photo Albums, and Profile Timeline.

let toystallerBooted = false;

function bootToystaller() {
    if (toystallerBooted) return;
    toystallerBooted = true;

    // Inject platforms/facebook.js and page_interceptor.js into the MAIN world
    const scriptsToInject = [
        'platforms/facebook.js',
        'page_interceptor.js'
    ];

    let currentScriptIdx = 0;
    const injectNext = () => {
        if (currentScriptIdx >= scriptsToInject.length) return;
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(scriptsToInject[currentScriptIdx]);
        script.onload = () => {
            script.remove();
            currentScriptIdx++;
            injectNext();
        };
        (document.head || document.documentElement).appendChild(script);
    };
    injectNext();

    injectDownloadButtons();
    setInterval(injectDownloadButtons, 1200);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

const pageInterceptedVideoUrls = new Set();
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'toystaller_video_urls' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(url => {
            if (isValidVideoUrl(url)) {
                pageInterceptedVideoUrls.add(url);
            }
        });
    }
});

// Safe wrapper for chrome.runtime.sendMessage to prevent
// "Extension context invalidated" errors after extension reload
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

function triggerDownload(url) {
    safeSendMessage({ action: 'downloadMedia', url: url }, (response) => {
        if (!response || !response.success) {
            console.error("Download failed or was rejected.");
        }
    });
}

function cleanVideoUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let clean = url;
    clean = clean.replace(/\\\//g, '/');
    clean = clean.replace(/&amp;/g, '&')
                 .replace(/\\u0026/g, '&')
                 .replace(/\u0026/g, '&')
                 .replace(/\\u002526/g, '&');
    clean = clean.replace(/([?&])bytestart=\d+&?/g, '$1')
                 .replace(/([?&])byteend=\d+&?/g, '$1');
    clean = clean.replace(/[?&]$/, '');
    return clean.trim().replace(/^["']|["']$/g, '');
}

function isValidVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (lower.startsWith('blob:') || lower.startsWith('data:')) return false;
    if (lower.includes('facebook.com') || lower.includes('messenger.com') || lower.includes('instagram.com')) return false;
    if (lower.includes('unified_cvc')) return false;
    if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash')) return false;
    
    // Reject image extensions & covers
    if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('videocover') || lower.includes('/t15.')) {
        return false;
    }

    const isCdn = lower.includes('fbcdn.net') || lower.includes('fbsbx.com');
    const isVideoExt = lower.includes('.mp4') || lower.includes('.m4v') || lower.includes('.webm');
    const isVideoPath = lower.includes('/v/t42.') || lower.includes('/v/t64.') || lower.includes('/video/') || lower.includes('mime=video');

    return isCdn && (isVideoExt || isVideoPath);
}

function scoreVideoUrl(url) {
    let score = 0;
    const lower = url.toLowerCase();
    if (lower.includes('.mp4') || lower.includes('.m4v')) score += 15;
    if (lower.includes('quality_hd') || lower.includes('_hd') || lower.includes('native_hd')) score += 30;
    if (lower.includes('video.fbcdn.net')) score += 20;
    if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('/playlist/') || lower.includes('/manifest/') || lower.includes('stream_type=dash') || lower.includes('dash')) score -= 50;
    
    // Aggressive scoring for HD resolutions
    if (lower.includes('1080')) score += 25;
    else if (lower.includes('720')) score += 15;
    else if (lower.includes('480')) score += 5;
    else if (lower.includes('360')) score += 2;
    
    // Heavily penalize image thumbnails
    if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('/t15.')) {
        score -= 500;
    }

    score += Math.min(url.length / 100, 5);
    return score;
}

function pickBestVideoUrl(urls) {
    if (!urls || urls.length === 0) return null;
    const cleaned = urls.map(cleanVideoUrl).filter(Boolean);
    let playable = cleaned.filter(u => isValidVideoUrl(u));
    if (playable.length === 0) return null;
    const sorted = [...playable].sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
    return sorted[0];
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

const FALLBACK_PLATFORM = {
    name: 'fallback',
    hasActiveModal() { return false; },
    isInsideModal() { return false; },
    isThumbnail(media) {
        if (media.tagName.toLowerCase() !== 'img') return false;
        const rect = media.getBoundingClientRect();
        const naturalW = media.naturalWidth || media.width;
        const naturalH = media.naturalHeight || media.height;
        if (naturalW >= 200 && naturalH >= 200) return false;
        if (naturalW < 100 || naturalH < 100) return true;
        if (rect.width < 100 || rect.height < 100) return true;
        return false;
    },
    getButtonScale() { return 1; },
    filterBackgroundUrls(candidates) { return candidates.filter(isValidVideoUrl); }
};

const PlatformManager = {
    getPlatform() {
        const platforms = window.ToystallerPlatforms;
        if (platforms && platforms['facebook']) return platforms['facebook'];
        if (window.ToystallerActivePlatform) return window.ToystallerActivePlatform;
        return FALLBACK_PLATFORM;
    }
};

function injectDownloadButtons() {
    if (isRawMediaTab()) return;

    const platform = PlatformManager.getPlatform();
    const hasModal = platform.hasActiveModal();

    // Re-sync existing overlay displays when modal state changes
    if (window.magicOverlayManager) {
        window.magicOverlayManager.updateAllPositions();
    }

    const mediaElements = document.querySelectorAll('video, img, svg image, image');

    mediaElements.forEach(media => {
        if (platform.isThumbnail(media)) return;
        
        // If a modal is open, strictly ignore any media not inside the modal
        if (hasModal && !platform.isInsideModal(media)) return;

        if (window.magicOverlayManager && !window.magicOverlayManager.overlays.has(media)) {
            const isVideo = media.tagName.toLowerCase() === 'video';
            const magicId = Math.random().toString(36).substring(2, 15);
            if (isVideo) {
                media.dataset.magicId = magicId;
            }

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
                    opacity: 0.55;
                    transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.45);
                    transform: scale(${scale});
                    transform-origin: center;
                    margin: 0 4px;
                `;

                const iconSize = Math.round(16 * scale);

                const getHighResImageUrl = () => {
                    let finalUrl = media.currentSrc || media.src;
                    if (!finalUrl && (media.tagName.toLowerCase() === 'image' || media.tagName.toLowerCase() === 'svg')) {
                        finalUrl = media.getAttribute('xlink:href') || 
                                   media.getAttribute('href') || 
                                   (media.href && media.href.baseVal ? media.href.baseVal : null);
                    }
                    
                    if (media.srcset) {
                        const srcsetItems = media.srcset.split(',').map(s => s.trim().split(' '));
                        if (srcsetItems.length > 0) {
                            const largest = srcsetItems.sort((a, b) => {
                                const wA = parseInt(a[1] || '0');
                                const wB = parseInt(b[1] || '0');
                                return wB - wA;
                            })[0];
                            if (largest && largest[0]) {
                                finalUrl = largest[0];
                            }
                        }
                    }
                    
                    if (finalUrl) {
                        const lower = finalUrl.toLowerCase();
                        if (lower.startsWith('blob:') || lower.startsWith('data:')) return null;
                        if (lower.includes('//www.facebook.com') || lower.includes('//facebook.com') || lower.includes('//web.facebook.com')) return null;
                    }
                    
                    return finalUrl;
                };

                // Blue Button: Open Video/Image in new tab
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open HD video in new tab' : 'Open photo in new tab';
                openBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                // For video elements, pre-resolve in background
                if (isVideo) {
                    openBtn.title = 'Open HD video in new tab';
                }

                openBtn.addEventListener('mouseenter', () => {
                    openBtn.style.opacity = '1';
                    openBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
                });
                openBtn.addEventListener('mouseleave', () => {
                    openBtn.style.opacity = '0.55';
                    openBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                openBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isVideo) {
                        const imgMagicId = Math.random().toString(36).substring(2, 15);
                        media.setAttribute('data-magic-id', imgMagicId);
                        let resolved = false;
                        const handler = (ev) => {
                            if (!ev.data || ev.data.type !== 'magic_response_react_url_' + imgMagicId) return;
                            if (resolved) return;
                            resolved = true;
                            window.removeEventListener('message', handler);
                            if (ev.data.url) {
                                safeSendMessage({ action: 'openInNewTab', url: ev.data.url });
                            } else {
                                safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl() });
                            }
                        };
                        window.addEventListener('message', handler);
                        window.postMessage({ type: 'magic_get_react_url', id: imgMagicId, isVideo: false }, '*');
                        setTimeout(() => {
                            if (resolved) return;
                            resolved = true;
                            window.removeEventListener('message', handler);
                            safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl() });
                        }, 250);
                    } else {
                        const openVideo = (url) => {
                            const clean = cleanVideoUrl(url);
                            if (clean && isValidVideoUrl(clean)) {
                                safeSendMessage({ action: 'openInNewTab', url: clean, isVideo: true });
                            } else {
                                alert('Could not find the HD video URL yet.\n\nTip: Make sure the video has started playing, then click the button again.');
                            }
                        };

                        if (openBtn.__resolvedVideoUrl && isValidVideoUrl(openBtn.__resolvedVideoUrl)) {
                            openVideo(openBtn.__resolvedVideoUrl);
                        } else {
                            getMediaUrl(openVideo);
                        }
                    }
                });
                buttons.push(openBtn);

                // Red Button: Open Thumbnail/Poster in new tab
                const imgBtn = document.createElement('button');
                imgBtn.className = 'magic-img-btn';
                imgBtn.title = isVideo ? 'Open thumbnail in new tab' : 'Open image in new tab';
                imgBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                imgBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');
                imgBtn.addEventListener('mouseenter', () => {
                    imgBtn.style.opacity = '1';
                    imgBtn.style.backgroundColor = 'rgba(231, 76, 60, 0.95)';
                });
                imgBtn.addEventListener('mouseleave', () => {
                    imgBtn.style.opacity = '0.55';
                    imgBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                });
                imgBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isVideo) {
                        let poster = media.getAttribute('poster');
                        
                        // Fallback 1: Look for nearby image tag
                        if (!poster) {
                            let current = media;
                            for (let i = 0; i < 4 && current && !poster; i++) {
                                const img = current.querySelector ? current.querySelector('img') : null;
                                if (img && img.src && !img.src.startsWith('data:')) {
                                    poster = img.src;
                                }
                                current = current.parentElement;
                            }
                        }

                        // Fallback 2: React Fiber extraction for poster
                        const thumbMagicId = Math.random().toString(36).substring(2, 15);
                        media.setAttribute('data-magic-id', thumbMagicId);
                        let resolved = false;
                        const handler = (ev) => {
                            if (!ev.data || ev.data.type !== 'magic_response_react_url_' + thumbMagicId) return;
                            if (resolved) return;
                            resolved = true;
                            window.removeEventListener('message', handler);
                            if (ev.data.url) {
                                safeSendMessage({ action: 'openInNewTab', url: ev.data.url });
                            } else if (poster) {
                                safeSendMessage({ action: 'openInNewTab', url: poster });
                            } else {
                                alert('No thumbnail image available for this video.');
                            }
                        };
                        window.addEventListener('message', handler);
                        window.postMessage({ type: 'magic_get_react_url', id: thumbMagicId, isVideo: false }, '*');
                        
                        setTimeout(() => {
                            if (resolved) return;
                            resolved = true;
                            window.removeEventListener('message', handler);
                            if (poster) {
                                safeSendMessage({ action: 'openInNewTab', url: poster });
                            } else {
                                alert('No thumbnail image available for this video.');
                            }
                        }, 350);
                    } else {
                        safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl() });
                    }
                });
                buttons.push(imgBtn);

                return buttons;
            };

            // Pre-resolve video URL to conditionally show/hide the blue button
            const preResolveVideoUrl = (openBtn) => {
                if (!isVideo) return;
                getMediaUrl((url) => {
                    const clean = cleanVideoUrl(url);
                    if (clean && isValidVideoUrl(clean)) {
                        openBtn.__resolvedVideoUrl = clean;
                        openBtn.style.display = 'flex';
                    }
                }, true);
            };

            const getMediaUrl = (callback, silent = false) => {
                if (isVideo) {
                    let resolved = false;
                    const handler = (e) => {
                        if (!e.data || e.data.type !== 'magic_response_react_url_' + magicId) return;
                        if (resolved) return;
                        resolved = true;
                        window.removeEventListener('message', handler);
                        const clean = cleanVideoUrl(e.data.url);
                        if (clean && isValidVideoUrl(clean)) {
                            callback(clean);
                        } else {
                            getMediaUrlFallback(callback, silent);
                        }
                    };
                    window.addEventListener('message', handler);
                    window.postMessage({ type: 'magic_get_react_url', id: magicId, isVideo: isVideo }, '*');

                    setTimeout(() => {
                        if (resolved) return;
                        resolved = true;
                        window.removeEventListener('message', handler);
                        getMediaUrlFallback(callback, silent);
                    }, 400);
                    return;
                }

                getMediaUrlFallback(callback, silent);
            };

            const getMediaUrlFallback = (callback, silent = false) => {
                // 1. Check in-memory intercepted video URLs from fetch/XHR
                if (isVideo && pageInterceptedVideoUrls.size > 0) {
                    const platform = PlatformManager.getPlatform();
                    const cleaned = Array.from(pageInterceptedVideoUrls).map(cleanVideoUrl).filter(Boolean);
                    const candidates = cleaned.filter(isValidVideoUrl);
                    const filtered = platform.filterBackgroundUrls ? platform.filterBackgroundUrls(candidates, true) : candidates;

                    if (filtered.length > 0) {
                        const best = pickBestVideoUrl(filtered);
                        if (best && isValidVideoUrl(best)) {
                            callback(best);
                            return;
                        }
                    }
                }

                // 2. Direct scan of document <script> tags from content script context
                if (isVideo) {
                    const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
                    const scriptCandidates = [];
                    const cdnRegex = /"(https:(?:\\\/\\\/|\/\/)[^"]+?(?:fbcdn\.net|fbsbx\.com)[^"]+?\.(?:mp4|m4v)[^"]*)"/g;
                    for (const s of scripts) {
                        const text = s.textContent;
                        if (!text || (!text.includes('fbcdn.net') && !text.includes('fbsbx.com') && !text.includes('playable_url'))) continue;
                        let m;
                        while ((m = cdnRegex.exec(text)) !== null) {
                            try {
                                const u = cleanVideoUrl(JSON.parse('"' + m[1] + '"'));
                                if (u && isValidVideoUrl(u)) scriptCandidates.push(u);
                            } catch(e) {
                                const unescaped = cleanVideoUrl(m[1]);
                                if (unescaped && isValidVideoUrl(unescaped)) scriptCandidates.push(unescaped);
                            }
                        }
                    }
                    if (scriptCandidates.length > 0) {
                        const best = pickBestVideoUrl(scriptCandidates);
                        if (best && isValidVideoUrl(best)) {
                            callback(best);
                            return;
                        }
                    }
                }

                // 3. Fallback to background script webRequest
                const mediaType = isVideo ? 'video' : 'img';
                safeSendMessage({ action: 'getMediaUrls', mediaType: mediaType }, (response) => {
                    if (response && response.urls && response.urls.length > 0) {
                        const cleaned = response.urls.map(cleanVideoUrl).filter(Boolean);
                        const candidates = cleaned.filter(isValidVideoUrl);
                        if (candidates.length > 0) {
                            const best = pickBestVideoUrl(candidates);
                            if (best && isValidVideoUrl(best)) {
                                callback(best);
                                return;
                            }
                        }
                    }
                    if (!silent) {
                        alert('Could not find the HD video URL yet.\n\nTip: Make sure the video has started playing, then click the button again.');
                    }
                });
            };

            if (window.magicOverlayManager) {
                window.magicOverlayManager.addOverlay(media, createButtonsFn);
                if (isVideo) {
                    const doPreResolve = () => {
                        const overlay = window.magicOverlayManager.overlays.get(media);
                        if (overlay && overlay.container) {
                            const openBtn = overlay.container.querySelector('.magic-open-btn');
                            if (openBtn) {
                                preResolveVideoUrl(openBtn);
                            }
                        }
                    };
                    setTimeout(doPreResolve, 200);
                    media.addEventListener('play', doPreResolve, { passive: true });
                    media.addEventListener('playing', doPreResolve, { passive: true });
                }
            }
        }
    });
}

let injectTimer = null;
function scheduleInject() {
    if (injectTimer) return;
    injectTimer = setTimeout(() => {
        injectTimer = null;
        injectDownloadButtons();
    }, 150);
}

// Automatically boot for Facebook
bootToystaller();

// --- Dashboard UI Injection ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleDashboard') {
        toggleDashboardOverlay();
        sendResponse({ success: true });
    }
});

let dashboardHost = null;

function toggleDashboardOverlay() {
    if (dashboardHost) {
        dashboardHost.remove();
        dashboardHost = null;
        return;
    }

    dashboardHost = document.createElement('div');
    dashboardHost.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 2147483647;';
    document.body.appendChild(dashboardHost);

    const shadow = dashboardHost.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
        <style>
            :host {
                all: initial;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .dashboard {
                width: 320px;
                background: rgba(20, 20, 20, 0.85);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 20px;
                color: #fff;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                animation: slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(-20px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }
            .header h2 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                background: linear-gradient(135deg, #1877f2 0%, #00f2fe 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .close-btn {
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                font-size: 20px;
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
                font-size: 13px;
                color: #aaa;
                text-align: center;
                padding: 8px 0;
            }
            .specialization {
                margin-top: 10px;
                padding: 12px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                font-size: 12px;
                line-height: 1.5;
                color: #ddd;
                border-left: 3px solid #1877f2;
            }
        </style>
        
        <div class="dashboard">
            <div class="header">
                <h2>Toystaller v6 — Facebook</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on Facebook
            </div>
            <div class="specialization">
                <strong>Features:</strong><br/>
                • Watch & Reels HD Video Extraction<br/>
                • Theater Mode Full-Resolution Photo Downloads<br/>
                • News Feed & Group Media Downloads<br/>
                • Zero Overlay Bleed & Instant Dialog Isolation
            </div>
        </div>
    `;

    shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);
}
