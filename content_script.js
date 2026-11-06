// content_script.js
// Finds media (videos and images) and injects download/open buttons.
// v3: Dashboard UI overlay, conditional site injection.

let toystallerBooted = false;

function bootToystaller() {
    if (toystallerBooted) return;
    toystallerBooted = true;

    // Inject platform script and page_interceptor.js dynamically into the MAIN world
    // to ensure they have access to the same window object and execute in order.
    const host = window.location.hostname.toLowerCase();
    let platformScript = 'platforms/generic.js';
    if (host.includes('instagram.com')) platformScript = 'platforms/instagram.js';
    else if (host.includes('facebook.com')) platformScript = 'platforms/facebook.js';
    else if (host.includes('linkedin.com')) platformScript = 'platforms/linkedin.js';
    else if (host.includes('whatsapp.com')) platformScript = 'platforms/whatsapp.js';

    const scriptsToInject = [
        platformScript,
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
    setInterval(injectDownloadButtons, 1500);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

const pageInterceptedVideoUrls = new Set();
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'toystaller_video_urls' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(url => pageInterceptedVideoUrls.add(url));
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
    // Strictly filter out DASH fragments which are unplayable in a new tab and cause black screens
    let playable = urls.filter(u => {
        const lower = u.toLowerCase();
        if (lower.includes('bytestart') || lower.includes('byteend')) return false;
        if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp')) return false;
        // Reject streaming manifests that cause black screens
        if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash')) return false;
        return true;
    });
    if (playable.length === 0) {
        // If absolutely nothing else is available, fallback to whatever we have (except images)
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

// Safe fallback platform — used if platform modules haven't loaded yet
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
        const host = window.location.hostname.toLowerCase();
        const platforms = window.ToystallerPlatforms;
        if (platforms) {
            if (host.includes('instagram.com') && platforms['instagram']) return platforms['instagram'];
            if (host.includes('facebook.com') && platforms['facebook']) return platforms['facebook'];
            if (host.includes('linkedin.com') && platforms['linkedin']) return platforms['linkedin'];
            if (host.includes('whatsapp.com') && platforms['whatsapp']) return platforms['whatsapp'];
            if (platforms['generic']) return platforms['generic'];
        }
        if (window.ToystallerActivePlatform) return window.ToystallerActivePlatform;
        if (window.ToystallerPlatform) return window.ToystallerPlatform;
        return FALLBACK_PLATFORM;
    }
};

function injectDownloadButtons() {
    if (isRawMediaTab()) return;

    const mediaElements = document.querySelectorAll('video, img');
    const platform = PlatformManager.getPlatform();
    const hasModal = platform.hasActiveModal();

    mediaElements.forEach(media => {
        if (platform.isThumbnail(media)) return;
        
        // If a modal is open, only inject on elements inside the modal
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
                    
                    if (finalUrl && finalUrl.includes('media.licdn.com/dms/image')) {
                        finalUrl = finalUrl.replace(/\/(100|200|400|800)\//g, '/1000/');
                    }
                    
                    // Do not return blob URLs or internal page URLs as images
                    if (finalUrl) {
                        const lower = finalUrl.toLowerCase();
                        if (lower.startsWith('blob:') || lower.startsWith('data:')) return null;
                        if (lower.includes('//www.facebook.com') || lower.includes('//facebook.com')) return null;
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

                // For video elements, hide the blue button until we confirm a valid URL exists
                if (isVideo) {
                    openBtn.style.display = 'none';
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
                    const platform = PlatformManager.getPlatform();
                    const platformName = platform.name || '';
                    if (!isVideo) {
                        safeSendMessage({ 
                            action: 'openInNewTab', 
                            url: getHighResImageUrl(), 
                            isVideo: false, 
                            platform: platformName 
                        });
                    } else {
                        getMediaUrl((url) => {
                            if (!url) return;
                            safeSendMessage({ 
                                action: 'openInNewTab', 
                                url: url, 
                                isVideo: true, 
                                platform: platformName 
                            });
                        });
                    }
                });
                buttons.push(openBtn);

                // Red Button: Open Thumbnail/Image in new tab (same arrow icon, red hover)
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
                    const host = window.location.hostname.toLowerCase();
                    if (isVideo) {
                        let poster = media.getAttribute('poster');
                        
                        // Fallback 1: Look for a nearby image tag (very common in Instagram/Facebook custom players)
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

                        // Fallback 2: LinkedIn specific network interception
                        if (!poster) {
                            if (host.includes('linkedin.com')) {
                                if (pageInterceptedVideoUrls.size > 0) {
                                    const covers = Array.from(pageInterceptedVideoUrls).filter(u => u.includes('videocover'));
                                    if (covers.length > 0) poster = covers[0];
                                }
                                
                                if (!poster) {
                                    safeSendMessage({ action: 'getMediaUrls', mediaType: 'img' }, (response) => {
                                        if (response && response.urls && response.urls.length > 0) {
                                            const covers = response.urls.filter(u => u.includes('videocover'));
                                            if (covers.length > 0) {
                                                safeSendMessage({ action: 'openInNewTab', url: covers[0], isVideo: false, platform: 'LinkedIn' });
                                                return;
                                            }
                                        }
                                        alert('No thumbnail image available for this video.');
                                    });
                                    return;
                                }
                            }
                        }

                        // Fallback 3: Use React Fiber extraction for images (common on Instagram and Facebook)
                        if (!poster && (host.includes('instagram.com') || host.includes('facebook.com'))) {
                            const magicId = Math.random().toString(36).substring(2, 15);
                            media.setAttribute('data-magic-id', magicId);
                            let resolved = false;
                            const handler = (e) => {
                                if (!e.data || e.data.type !== 'magic_response_react_url_' + magicId) return;
                                if (resolved) return;
                                resolved = true;
                                window.removeEventListener('message', handler);
                                if (e.data.url) {
                                    const pName = host.includes('facebook.com') ? 'Facebook' : 'Instagram';
                                    safeSendMessage({ action: 'openInNewTab', url: e.data.url, isVideo: false, platform: pName });
                                } else {
                                    alert('No thumbnail image available for this video.');
                                }
                            };
                            window.addEventListener('message', handler);
                            window.postMessage({ type: 'magic_get_react_url', id: magicId, isVideo: false }, '*');
                            
                            setTimeout(() => {
                                if (resolved) return;
                                resolved = true;
                                window.removeEventListener('message', handler);
                                alert('No thumbnail image available for this video.');
                            }, 500);
                            return; // exit early because it's async
                        }

                        const pName = PlatformManager.getPlatform().name || '';
                        if (poster) {
                            safeSendMessage({ action: 'openInNewTab', url: poster, isVideo: false, platform: pName });
                        } else {
                            alert('No thumbnail image available for this video.');
                        }
                    } else {
                        const pName = PlatformManager.getPlatform().name || '';
                        safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl(), isVideo: false, platform: pName });
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
                        // Cache the resolved URL and show the button
                        openBtn.__resolvedVideoUrl = url;
                        openBtn.style.display = 'flex';
                    }
                    // If no URL found, button stays hidden
                }, true); // Silent check
            };

            const getMediaUrl = (callback, silent = false) => {
                // Step 1: Try React Fiber extraction (works on Instagram)
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
                            if (window.location.hostname.includes('facebook.com') && isVideo) {
                                // Fallback for Facebook: attempt mobile site extraction via background script
                                safeSendMessage({ action: 'fetchMobileFacebookVideo', url: window.location.href }, (response) => {
                                    if (response && response.url) {
                                        callback(response.url);
                                    } else {
                                        getMediaUrlFallback(callback, silent);
                                    }
                                });
                            } else {
                                getMediaUrlFallback(callback, silent);
                            }
                        }
                    };
                    window.addEventListener('message', handler);
                    window.postMessage({ type: 'magic_get_react_url', id: magicId, isVideo: isVideo }, '*');

                    setTimeout(() => {
                        if (resolved) return;
                        resolved = true;
                        window.removeEventListener('message', handler);
                        getMediaUrlFallback(callback, silent);
                    }, 300);
                    return;
                }

                getMediaUrlFallback(callback, silent);
            };

            const getMediaUrlFallback = (callback, silent = false) => {
                const currentSrc = media.currentSrc || media.src || '';
                const isBlobSource = currentSrc.startsWith('blob:') || currentSrc.startsWith('data:');
                const host = window.location.hostname.toLowerCase();

                // Social platform blob: fallback since they use blob: URLs and filename matching is impossible.
                // Grab the best platform-specific CDN video URL from intercepted URLs.
                if (isVideo && isBlobSource && pageInterceptedVideoUrls.size > 0) {
                    const platform = PlatformManager.getPlatform();
                    const platformVideos = platform.filterBackgroundUrls ? platform.filterBackgroundUrls(Array.from(pageInterceptedVideoUrls), true) : Array.from(pageInterceptedVideoUrls);

                    if (platformVideos.length > 0) {
                        const best = pickBestVideoUrl(platformVideos);
                        if (best) {
                            callback(best);
                            return;
                        }
                    }
                }

                const getFilename = (urlStr) => {
                    try {
                        const parts = new URL(urlStr).pathname.split('/');
                        const name = parts.pop();
                        return (name && name.length > 5) ? name : null;
                    } catch (e) { return null; }
                };

                const currentFilename = getFilename(currentSrc);

                if (isVideo && pageInterceptedVideoUrls.size > 0 && currentFilename) {
                    const matches = Array.from(pageInterceptedVideoUrls).filter(u => {
                        const interceptedName = getFilename(u);
                        return interceptedName && interceptedName === currentFilename && !u.includes('bytestart');
                    });

                    if (matches.length > 0) {
                        const best = pickBestVideoUrl(matches);
                        if (best) {
                            callback(best);
                            return;
                        }
                    }
                }

                const isInternalPage = (urlStr) => {
                    const lower = (urlStr || '').toLowerCase();
                    return lower.includes('//www.facebook.com') ||
                           lower.includes('//facebook.com') ||
                           lower.includes('//www.instagram.com') ||
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
                // After overlay is created, pre-resolve the video URL
                if (isVideo) {
                    // Small delay to let the overlay manager create the buttons
                    setTimeout(() => {
                        const overlay = window.magicOverlayManager.overlays.get(media);
                        if (overlay && overlay.container) {
                            const openBtn = overlay.container.querySelector('.magic-open-btn');
                            if (openBtn) {
                                preResolveVideoUrl(openBtn);
                            }
                        }
                    }, 100);
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
    }, 200);
}

// Removed direct calls; handled by bootToystaller()

const defaultAllowed = ['instagram.com', 'linkedin.com', 'facebook.com', 'whatsapp.com'];
const currentHost = window.location.hostname.toLowerCase();
const isDefault = defaultAllowed.some(s => currentHost.includes(s));

if (isDefault) {
    bootToystaller();
} else {
    chrome.storage.local.get({ globalEnabled: false, allowedSites: defaultAllowed }, (result) => {
        if (result.globalEnabled || result.allowedSites.some(s => currentHost.includes(s))) {
            bootToystaller();
        }
    });
}

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
    // Ensure highest z-index and fixed position
    dashboardHost.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 2147483647;';
    document.body.appendChild(dashboardHost);

    const shadow = dashboardHost.attachShadow({ mode: 'open' });

    chrome.storage.local.get({ globalEnabled: false, allowedSites: defaultAllowed, openInMainWindow: false }, (result) => {
        const host = window.location.hostname.toLowerCase();
        const isAllowed = result.allowedSites.some(s => host.includes(s));

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
                    margin-bottom: 20px;
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
                
                .setting-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                }
                .setting-row:last-child {
                    margin-bottom: 0;
                    padding-bottom: 0;
                    border-bottom: none;
                }
                .setting-info h3 {
                    margin: 0 0 4px 0;
                    font-size: 14px;
                    font-weight: 500;
                }
                .setting-info p {
                    margin: 0;
                    font-size: 12px;
                    color: #aaa;
                }
                
                .switch {
                    position: relative;
                    display: inline-block;
                    width: 44px;
                    height: 24px;
                }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: rgba(255, 255, 255, 0.1);
                    transition: .3s;
                    border-radius: 24px;
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 18px;
                    width: 18px;
                    left: 3px;
                    bottom: 3px;
                    background-color: white;
                    transition: .3s;
                    border-radius: 50%;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                input:checked + .slider {
                    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                }
                input:checked + .slider:before {
                    transform: translateX(20px);
                }
                .btn {
                    width: 100%;
                    padding: 10px;
                    border-radius: 8px;
                    border: none;
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                    font-weight: 600;
                    cursor: pointer;
                    margin-top: 15px;
                    transition: background 0.2s;
                }
                .btn:hover { background: rgba(255, 255, 255, 0.15); }
            </style>
            
            <div class="dashboard">
                <div class="header">
                    <h2>Toystaller v6</h2>
                    <button class="close-btn" id="closeBtn" title="Close">&times;</button>
                </div>
                
                <div class="setting-row">
                    <div class="setting-info">
                        <h3>Enable on this site</h3>
                        <p>${host || 'Local file'}</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="siteToggle" ${isAllowed ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="setting-row">
                    <div class="setting-info">
                        <h3>Global Override</h3>
                        <p>Enable Toystaller everywhere</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="globalToggle" ${result.globalEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="setting-row">
                    <div class="setting-info">
                        <h3>Open in Main Window</h3>
                        <p>Off by default (keeps tabs in current window / incognito)</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="jumpMainToggle" ${result.openInMainWindow ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <button class="btn" id="reloadBtn" style="display: none;">Reload Page to Apply</button>
            </div>
        `;

        shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);

        const reloadBtn = shadow.getElementById('reloadBtn');
        const showReload = () => { reloadBtn.style.display = 'block'; };

        shadow.getElementById('siteToggle').addEventListener('change', (e) => {
            const checked = e.target.checked;
            chrome.storage.local.get({ allowedSites: defaultAllowed }, (res) => {
                let sites = res.allowedSites;
                if (checked) {
                    if (!sites.includes(host)) sites.push(host);
                } else {
                    sites = sites.filter(s => s !== host);
                }
                chrome.storage.local.set({ allowedSites: sites }, showReload);
            });
        });

        shadow.getElementById('globalToggle').addEventListener('change', (e) => {
            chrome.storage.local.set({ globalEnabled: e.target.checked }, showReload);
        });

        shadow.getElementById('jumpMainToggle').addEventListener('change', (e) => {
            chrome.storage.local.set({ openInMainWindow: e.target.checked });
        });

        reloadBtn.addEventListener('click', () => window.location.reload());
    });
}
