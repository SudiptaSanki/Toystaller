// content_script.js
// Specialized Instagram Media Extractor & Button Injector.
// Supports: Profile Grid, Post/Reel Modals, Standalone Posts, Feed, Reels, Stories, DMs.

let toystallerBooted = false;

function bootToystaller() {
    if (toystallerBooted) return;
    toystallerBooted = true;

    // Inject platforms/instagram.js and page_interceptor.js into the MAIN world
    const scriptsToInject = [
        'specialized/instagram/platforms/instagram.js',
        'specialized/instagram/page_interceptor.js'
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

const pageInterceptedVideoUrls = [];
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'toystaller_video_urls' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(url => {
            if (url && typeof url === 'string') {
                const idx = pageInterceptedVideoUrls.findIndex(item => item.url === url);
                if (idx !== -1) pageInterceptedVideoUrls.splice(idx, 1);
                pageInterceptedVideoUrls.unshift({ url, timestamp: Date.now() });
                if (pageInterceptedVideoUrls.length > 20) pageInterceptedVideoUrls.pop();
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

function scoreVideoUrl(url) {
    let score = 0;
    const lower = url.toLowerCase();
    if (lower.includes('.mp4') || lower.includes('.m4v')) score += 10;
    if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('/playlist/') || lower.includes('/manifest/') || lower.includes('stream_type=dash') || lower.includes('dash')) score -= 50;
    if (lower.includes('bytestart') || lower.includes('byteend')) score -= 50;
    
    // Aggressive scoring for HD resolutions
    if (lower.includes('1080')) score += 20;
    else if (lower.includes('720')) score += 10;
    else if (lower.includes('480')) score += 5;
    else if (lower.includes('360')) score += 2;
    
    // Heavily penalize image thumbnails to prevent them being picked as videos
    if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp')) {
        score -= 500;
    }

    score += Math.min(url.length / 100, 5);
    return score;
}

function pickBestVideoUrl(urls) {
    if (!urls || urls.length === 0) return null;
    let playable = urls.filter(u => {
        const lower = u.toLowerCase();
        if (lower.includes('bytestart') || lower.includes('byteend')) return false;
        if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp')) return false;
        if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash')) return false;
        return true;
    });
    if (playable.length === 0) {
        playable = urls.filter(u => {
            const lower = u.toLowerCase();
            return !(lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp'));
        });
        if (playable.length === 0) return null;
    }
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
    filterBackgroundUrls(candidates) { return candidates; }
};

const PlatformManager = {
    getPlatform() {
        const platforms = window.ToystallerPlatforms;
        if (platforms && platforms['instagram']) return platforms['instagram'];
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

    const mediaElements = document.querySelectorAll('video, img');

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
                        if (lower.includes('//www.instagram.com') || lower.includes('//instagram.com')) return null;
                    }
                    
                    return finalUrl;
                };

                // Blue Button: Open Video/Image in new tab
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open video in new tab' : 'Open image in new tab';
                openBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                // For video elements, style open button
                if (isVideo) {
                    openBtn.title = 'Open video in new tab';
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
                        getMediaUrl((url) => {
                            if (url) {
                                safeSendMessage({ action: 'openInNewTab', url: url, isVideo: true, platform: 'instagram' });
                            } else {
                                alert('Could not find the video URL yet.\n\nTip: Make sure the video has started playing, then click the button again.');
                            }
                        });
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
                    if (url) {
                        openBtn.__resolvedVideoUrl = url;
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
                        if (e.data.url) {
                            callback(e.data.url);
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
                    }, 350);
                    return;
                }

                getMediaUrlFallback(callback, silent);
            };

            const getMediaUrlFallback = (callback, silent = false) => {
                const currentSrc = media.currentSrc || media.src || '';
                const isBlobSource = currentSrc.startsWith('blob:') || currentSrc.startsWith('data:');

                // 1. Locate enclosing post / reel container
                const postContainer = media.closest ? media.closest('article, [role="dialog"], [role="presentation"], div[data-pagelet*="Reel"], div[tabindex="-1"]') : null;
                const linkEl = postContainer ? postContainer.querySelector('a[href*="/p/"], a[href*="/reel/"]') : null;
                const postUrl = linkEl ? linkEl.href : window.location.href;
                const postMatch = postUrl.match(/\/(p|reel)\/([a-zA-Z0-9_\-]+)/);
                const postShortcode = postMatch ? postMatch[2] : null;

                const getFilename = (urlStr) => {
                    try {
                        const parts = new URL(urlStr).pathname.split('/');
                        const name = parts.pop();
                        return (name && name.length > 5) ? name : null;
                    } catch (e) { return null; }
                };

                const currentFilename = getFilename(currentSrc);

                // 2. Correlate with recently intercepted URLs (prioritize exact match or shortcode)
                if (isVideo && pageInterceptedVideoUrls.length > 0) {
                    const platform = PlatformManager.getPlatform();
                    const rawCandidates = pageInterceptedVideoUrls.map(item => item.url);
                    const filtered = platform.filterBackgroundUrls ? platform.filterBackgroundUrls(rawCandidates, true) : rawCandidates;

                    // Match by filename first if available
                    if (currentFilename) {
                        const fileMatches = filtered.filter(u => getFilename(u) === currentFilename && !u.includes('bytestart'));
                        if (fileMatches.length > 0) {
                            const best = pickBestVideoUrl(fileMatches);
                            if (best) {
                                callback(best);
                                return;
                            }
                        }
                    }

                    // Match by post shortcode if embedded in URL
                    if (postShortcode) {
                        const codeMatches = filtered.filter(u => u.includes(postShortcode));
                        if (codeMatches.length > 0) {
                            const best = pickBestVideoUrl(codeMatches);
                            if (best) {
                                callback(best);
                                return;
                            }
                        }
                    }

                    // For blob sources, use most recent candidate intercepted during the active playback window
                    if (isBlobSource && filtered.length > 0) {
                        // Use only the most recent 3 candidates so we don't pick an old scrolled reel
                        const recentCandidates = filtered.slice(0, 3);
                        const best = pickBestVideoUrl(recentCandidates);
                        if (best) {
                            callback(best);
                            return;
                        }
                    }
                }

                const isInternalPage = (urlStr) => {
                    const lower = (urlStr || '').toLowerCase();
                    return lower.includes('//www.instagram.com') ||
                           lower.includes('//instagram.com');
                };

                if (isVideo && media.currentSrc &&
                    !media.currentSrc.startsWith('blob:') &&
                    !media.currentSrc.startsWith('data:') &&
                    !isInternalPage(media.currentSrc)) {
                    callback(media.currentSrc);
                    return;
                }

                if (media.src && !media.src.startsWith('blob:') && !media.src.startsWith('data:') && !isInternalPage(media.src)) {
                    callback(media.src);
                    return;
                }

                if (isVideo) {
                    const sourceTag = media.querySelector('source');
                    if (sourceTag && sourceTag.src &&
                        !sourceTag.src.startsWith('blob:') &&
                        !sourceTag.src.startsWith('data:') &&
                        !isInternalPage(sourceTag.src)) {
                        callback(sourceTag.src);
                        return;
                    }
                }

                // Last resort: ask background script for network-intercepted URLs
                const mediaType = isVideo ? 'video' : 'img';
                safeSendMessage({ action: 'getMediaUrls', mediaType: mediaType }, (response) => {
                    if (response && response.urls && response.urls.length > 0) {
                        const platform = PlatformManager.getPlatform();
                        let candidates = response.urls;
                        const filtered = platform.filterBackgroundUrls(candidates, isVideo);
                        if (filtered && filtered.length > 0) candidates = filtered;
                        
                        const best = pickBestVideoUrl(candidates);
                        if (best) {
                            callback(best);
                            return;
                        }
                    }
                    if (!silent) {
                        alert('Could not find the video URL yet.\n\nTip: Make sure the video has started playing, then click the button again.');
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
                    media.addEventListener('loadstart', () => {
                        const overlay = window.magicOverlayManager.overlays.get(media);
                        if (overlay && overlay.container) {
                            const openBtn = overlay.container.querySelector('.magic-open-btn');
                            if (openBtn) openBtn.__resolvedVideoUrl = null;
                        }
                    }, { passive: true });
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

// Automatically boot for Instagram
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
                background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
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
                border-left: 3px solid #4facfe;
            }
        </style>
        
        <div class="dashboard">
            <div class="header">
                <h2>Toystaller v6 — Instagram</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on Instagram
            </div>
            <div class="specialization">
                <strong>Features:</strong><br/>
                • Profile Grid & High-Res Avatar Downloads<br/>
                • Modal Post & Reel Video HD Extraction<br/>
                • Dedicated Reels & Stories Support<br/>
                • Zero Overlay Bleed & Instant Dialog Isolation
            </div>
        </div>
    `;

    shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);
}
