// core/content_core.js
// Shared content script logic — button injection, URL extraction, dashboard UI.
// Each platform extension sets window.ToystallerActivePlatform before this runs.

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
    if (!url || typeof url !== 'string') return -1000;
    let score = 0;
    const lower = url.toLowerCase();

    // Base video format recognition
    if (lower.includes('.mp4') || lower.includes('.m4v') || lower.includes('.webm')) score += 50;

    // Reject / heavily penalize unplayable fragments and manifests
    if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('/playlist/') || lower.includes('/manifest/') || lower.includes('stream_type=dash') || lower.includes('dash')) score -= 100;
    if (lower.includes('bytestart') || lower.includes('byteend')) score -= 100;

    // Heavily penalize image thumbnails to prevent them being picked as videos
    if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('/t15.')) {
        return -1000;
    }

    // High resolution detection (strictly prioritize original best quality)
    if (lower.includes('2160') || lower.includes('4k') || lower.includes('uhd')) score += 150;
    else if (lower.includes('1440') || lower.includes('2k') || lower.includes('qhd')) score += 120;
    else if (lower.includes('1080') || lower.includes('fhd') || lower.includes('_1080p')) score += 90;
    else if (lower.includes('720') || lower.includes('_720p') || lower.includes('hd')) score += 60;
    else if (lower.includes('480')) score += 20;
    else if (lower.includes('360')) score -= 15;
    else if (lower.includes('240') || lower.includes('144')) score -= 40;

    // Quality keywords in URL or query params
    if (lower.includes('playable_url_quality_hd') || lower.includes('browser_native_hd') || lower.includes('quality=hd') || lower.includes('_hd.mp4') || lower.includes('hd_src') || lower.includes('quality=1080') || lower.includes('quality=original')) {
        score += 80;
    }
    if (lower.includes('master') || lower.includes('source') || lower.includes('progressive') || lower.includes('original')) {
        score += 50;
    }
    if (lower.includes('quality_sd') || lower.includes('quality=sd') || lower.includes('sd_src') || lower.includes('_sd.mp4') || lower.includes('preview')) {
        score -= 50;
    }

    // Bitrate / Bandwidth scoring
    const bwMatch = lower.match(/(?:bitrate|bandwidth|br)[=_](\d+)/);
    if (bwMatch && bwMatch[1]) {
        score += Math.min(parseInt(bwMatch[1], 10) / 50000, 60);
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

// The active platform — set by the platform's content.js before this file loads.
function getActivePlatform() {
    return window.ToystallerActivePlatform || {
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
        filterBackgroundUrls(candidates) { return candidates; },
        useDirectDownload: false,
        isInternalUrl() { return false; }
    };
}

function injectDownloadButtons() {
    if (isRawMediaTab()) return;

    const mediaElements = document.querySelectorAll('video, img');
    const platform = getActivePlatform();
    const hasModal = platform.hasActiveModal();

    mediaElements.forEach(media => {
        if (platform.isThumbnail(media)) return;

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
                    let finalUrl = null;

                    // 1. Check direct high-res HTML5 & eCommerce attributes
                    const highResAttrs = [
                        'data-old-hires',
                        'data-zoom-image',
                        'data-large_image',
                        'data-large-image',
                        'data-original',
                        'data-orig',
                        'data-full',
                        'data-hires',
                        'data-high-res-src',
                        'data-full-url',
                        'data-src'
                    ];
                    for (const attr of highResAttrs) {
                        const val = media.getAttribute && media.getAttribute(attr);
                        if (val && typeof val === 'string' && val.startsWith('http') && !val.startsWith('data:') && !val.startsWith('blob:')) {
                            finalUrl = val;
                            break;
                        }
                    }

                    // 2. Check Amazon dynamic image JSON map (contains resolution array [width, height])
                    if (!finalUrl && media.getAttribute && media.getAttribute('data-a-dynamic-image')) {
                        try {
                            const dyn = JSON.parse(media.getAttribute('data-a-dynamic-image'));
                            const keys = Object.keys(dyn);
                            if (keys.length > 0) {
                                const sorted = keys.sort((a, b) => {
                                    const dimsA = Array.isArray(dyn[a]) ? dyn[a] : [0, 0];
                                    const dimsB = Array.isArray(dyn[b]) ? dyn[b] : [0, 0];
                                    return (dimsB[0] * dimsB[1]) - (dimsA[0] * dimsA[1]);
                                });
                                if (sorted[0]) finalUrl = sorted[0];
                            }
                        } catch (e) {}
                    }

                    // 3. Check enclosing anchor: Thumbnails are frequently wrapped in <a href="original.jpg">
                    if (!finalUrl && media.closest) {
                        const anchor = media.closest('a');
                        if (anchor && anchor.href) {
                            const aHref = anchor.href.trim();
                            if (/\.(jpe?g|png|webp|avif|gif)(\?.*)?$/i.test(aHref) && !aHref.startsWith('blob:') && !aHref.startsWith('data:')) {
                                finalUrl = aHref;
                            }
                        }
                    }

                    // 4. Check srcset: Pick the absolute largest candidate
                    if (!finalUrl && media.srcset) {
                        const srcsetItems = media.srcset.split(',').map(s => s.trim().split(' '));
                        if (srcsetItems.length > 0) {
                            const largest = srcsetItems.sort((a, b) => {
                                const wA = parseInt(a[1] || '0', 10);
                                const wB = parseInt(b[1] || '0', 10);
                                return wB - wA;
                            })[0];
                            if (largest && largest[0] && largest[0].startsWith('http')) {
                                finalUrl = largest[0];
                            }
                        }
                    }

                    // Fallback to currentSrc or src
                    if (!finalUrl) {
                        finalUrl = media.currentSrc || media.src;
                    }

                    if (!finalUrl || typeof finalUrl !== 'string') return null;

                    // 5. Universal De-Compression & Original Master Cleaners across all web platforms:

                    // Amazon: Strip sizing/crop modifiers (e.g. ._AC_SY450_., ._AC_UL320_.) -> uncompressed original
                    if (finalUrl.includes('media-amazon.com') || finalUrl.includes('images-amazon.com')) {
                        finalUrl = finalUrl.replace(/\._[A-Z0-9_,]+_\./i, '.');
                    }

                    // Pexels: Strip downsampling dimensions (w, h, dpr, fit, crop) -> camera original
                    if (finalUrl.includes('images.pexels.com')) {
                        try {
                            const u = new URL(finalUrl);
                            u.searchParams.delete('w');
                            u.searchParams.delete('h');
                            u.searchParams.delete('dpr');
                            u.searchParams.delete('fit');
                            u.searchParams.delete('crop');
                            u.searchParams.delete('auto');
                            finalUrl = u.toString();
                        } catch (e) {}
                    }

                    // Unsplash: Strip downsampling parameters -> maximum raw photo
                    if (finalUrl.includes('images.unsplash.com')) {
                        try {
                            const u = new URL(finalUrl);
                            u.searchParams.delete('w');
                            u.searchParams.delete('h');
                            u.searchParams.delete('fit');
                            u.searchParams.delete('crop');
                            u.searchParams.set('q', '100');
                            finalUrl = u.toString();
                        } catch (e) {}
                    }

                    // Twitter / X: Upgrade to original master quality (name=orig)
                    if (finalUrl.includes('twimg.com')) {
                        try {
                            const u = new URL(finalUrl);
                            if (u.searchParams.has('name')) {
                                u.searchParams.set('name', 'orig');
                                finalUrl = u.toString();
                            } else {
                                finalUrl = finalUrl.replace(/:(small|medium|large|thumb)$/i, ':orig');
                            }
                        } catch (e) {}
                    }

                    // Reddit: Replace preview with full original image host (i.redd.it)
                    if (finalUrl.includes('preview.redd.it')) {
                        try {
                            const u = new URL(finalUrl);
                            u.hostname = 'i.redd.it';
                            u.search = '';
                            finalUrl = u.toString();
                        } catch (e) {}
                    }

                    // Pinterest: Replace /236x/, /474x/, /736x/ with full /originals/
                    if (finalUrl.includes('pinimg.com')) {
                        finalUrl = finalUrl.replace(/\/\d+x\//, '/originals/');
                    }

                    // Google / Blogspot / Photos: Upgrade resize parameters to s0 (unlimited original size)
                    if (finalUrl.includes('googleusercontent.com') || finalUrl.includes('blogger.com') || finalUrl.includes('ggpht.com')) {
                        finalUrl = finalUrl.replace(/=(?:w\d+-h\d+|s\d+)(?:-[a-z0-9]+)*/i, '=s0');
                    }

                    // WordPress uploads: Strip downscaled dimension suffixes (e.g. -300x200.jpg -> .jpg)
                    if (finalUrl.includes('/wp-content/uploads/')) {
                        finalUrl = finalUrl.replace(/-\d+x\d+(\.[a-zA-Z0-9]+)$/, '$1');
                    }

                    // Shopify CDN: Strip size suffixes (e.g. _medium.jpg, _1024x1024.jpg -> .jpg)
                    if (finalUrl.includes('cdn.shopify.com')) {
                        finalUrl = finalUrl.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048)(\.[a-zA-Z0-9]+)$/i, '$1');
                    }

                    // LinkedIn: Upgrade shrink thumbnail sizes to master
                    if (finalUrl.includes('media.licdn.com/dms/image')) {
                        finalUrl = finalUrl.replace(/\/(100|200|400|800)\//g, '/1000/');
                        finalUrl = finalUrl.replace(/\/shrink_\d+_\d+\//g, '/');
                    }

                    // Platform-specific URL upgrading
                    if (platform.upgradeImageUrl) {
                        finalUrl = platform.upgradeImageUrl(finalUrl);
                    }

                    // Guard: Never return blob, data, or internal page URLs as images
                    const lower = finalUrl.toLowerCase();
                    if (lower.startsWith('blob:') || lower.startsWith('data:')) return null;
                    if (platform.isInternalUrl && platform.isInternalUrl(finalUrl)) return null;

                    return finalUrl;
                };

                // Blue Button: Open Video/Image in new tab (or direct download)
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open video in new tab' : 'Open image in new tab';
                openBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

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

                // Red Button: Open Thumbnail/Image in new tab
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

                        // Fallback 1: Look for a nearby image tag
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

                        // Fallback 2: Platform-specific thumbnail extraction
                        if (!poster && platform.extractThumbnail) {
                            platform.extractThumbnail(media, pageInterceptedVideoUrls, safeSendMessage, (url) => {
                                if (url) {
                                    safeSendMessage({ action: 'openInNewTab', url: url });
                                } else {
                                    alert('No thumbnail image available for this video.');
                                }
                            });
                            return;
                        }

                        // Fallback 3: React Fiber extraction for images
                        if (!poster && platform.useReactThumbnail) {
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
                                alert('No thumbnail image available for this video.');
                            }, 500);
                            return;
                        }

                        if (poster) {
                            safeSendMessage({ action: 'openInNewTab', url: poster });
                        } else {
                            alert('No thumbnail image available for this video.');
                        }
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
                // Step 1: Try React Fiber extraction
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
                            // Platform-specific fallback before generic fallback
                            if (platform.fetchVideoFallback) {
                                platform.fetchVideoFallback(window.location.href, safeSendMessage, (url) => {
                                    if (url) {
                                        callback(url);
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

                // Grab the best platform-specific CDN video URL from intercepted URLs
                if (isVideo && isBlobSource && pageInterceptedVideoUrls.size > 0) {
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

                if (isVideo && media.currentSrc &&
                    !media.currentSrc.startsWith('blob:') &&
                    !media.currentSrc.startsWith('data:') &&
                    !(platform.isInternalUrl && platform.isInternalUrl(media.currentSrc))) {
                    callback(media.currentSrc);
                    return;
                }

                if (media.src && !media.src.startsWith('blob:') && !media.src.startsWith('data:') &&
                    !(platform.isInternalUrl && platform.isInternalUrl(media.src))) {
                    callback(media.src);
                    return;
                }

                if (isVideo) {
                    const sourceTag = media.querySelector('source');
                    if (sourceTag && sourceTag.src &&
                        !sourceTag.src.startsWith('blob:') &&
                        !sourceTag.src.startsWith('data:') &&
                        !(platform.isInternalUrl && platform.isInternalUrl(sourceTag.src))) {
                        callback(sourceTag.src);
                        return;
                    }
                }

                // Last resort: ask background script
                const mediaType = isVideo ? 'video' : 'img';
                safeSendMessage({ action: 'getMediaUrls', mediaType: mediaType }, (response) => {
                    if (response && response.urls && response.urls.length > 0) {
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

// --- Boot function (called by each platform's content.js) ---
let toystallerBooted = false;

function bootToystaller(platformScripts, routerCode) {
    if (toystallerBooted) return;
    toystallerBooted = true;

    // Inject platform + interceptor scripts into the MAIN world sequentially
    if (platformScripts && platformScripts.length > 0) {
        let currentScriptIdx = 0;
        const injectNext = () => {
            if (currentScriptIdx >= platformScripts.length) {
                // After all scripts are injected, inject the optional router code
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
    setInterval(injectDownloadButtons, 1500);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

// --- Dashboard UI ---
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

    const platform = getActivePlatform();

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
            .info-row {
                font-size: 13px;
                color: #aaa;
                text-align: center;
                padding: 8px 0;
            }
            .specialization {
                margin-top: 15px;
                padding: 12px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                font-size: 13px;
                line-height: 1.5;
                color: #ddd;
                border-left: 3px solid #4facfe;
            }
        </style>

        <div class="dashboard">
            <div class="header">
                <h2>Toystaller ${platform.version || 'v6.0'} — ${platform.name || 'Unknown'}</h2>
                <button class="close-btn" id="closeBtn" title="Close">&times;</button>
            </div>
            <div class="info-row">
                Active on ${window.location.hostname}
            </div>
            ${platform.specialization ? `<div class="specialization"><strong>Specialization:</strong><br/>${platform.specialization}</div>` : ''}
        </div>
    `;

    shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);
}
