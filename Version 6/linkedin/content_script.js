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
    if (!url || typeof url !== 'string') return -1000;
    let score = 0;
    const lower = url.toLowerCase();

    // Strictly penalize and reject audio-only streams (e.g. Facebook /v/t42., mime=audio)
    if (lower.includes('/v/t42.') || lower.includes('mime=audio') || lower.includes('mime%3daudio') || lower.includes('stream_type=audio') || lower.includes('/audio/') || lower.includes('audio_')) {
        return -1000;
    }

    // Base video format recognition
    if (lower.includes('.mp4') || lower.includes('.m4v') || lower.includes('.webm')) score += 50;

    // Heavily boost progressive MP4s containing full audio (complete master video)
    if ((lower.includes('.mp4') || lower.includes('.m4v')) && !lower.includes('stream_type=dash') && !lower.includes('mime=video')) {
        score += 100;
    }
    // Penalize silent DASH video-only streams when progressive muxed MP4s exist
    if (lower.includes('stream_type=dash') || lower.includes('/o1/v/')) {
        score -= 60;
    }

    // Reject / heavily penalize unplayable fragments and manifests
    if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('/playlist/') || lower.includes('/manifest/')) score -= 100;
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
    // Strictly filter out DASH fragments, audio-only streams, and unplayable manifests
    let playable = urls.filter(u => {
        const lower = u.toLowerCase();
        if (lower.includes('/v/t42.') || lower.includes('mime=audio') || lower.includes('mime%3daudio') || lower.includes('stream_type=audio') || lower.includes('/audio/') || lower.includes('audio_')) return false;
        if (lower.includes('bytestart') || lower.includes('byteend')) return false;
        if (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp')) return false;
        // Reject streaming manifests that cause black screens
        if (lower.includes('.m3u8') || lower.includes('.mpd')) return false;
        return true;
    });
    if (playable.length === 0) {
        // If absolutely nothing else is available, fallback to whatever we have (except images and audio tracks)
        playable = urls.filter(u => {
            const lower = u.toLowerCase();
            return !(lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('/v/t42.') || lower.includes('mime=audio'));
        });
        if (playable.length === 0) return null;
    }
    const sorted = [...playable].sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
    return sorted[0];
}

function pickBestAudioUrl(urls) {
    if (!urls || urls.length === 0) return null;
    const audios = urls.filter(u => {
        const lower = u.toLowerCase();
        return (lower.includes('/v/t42.') || lower.includes('mime=audio') || lower.includes('mime%3daudio') || lower.includes('stream_type=audio') || lower.includes('/audio/') || lower.includes('audio_')) &&
               !lower.includes('bytestart') && !lower.includes('manifest');
    });
    return audios[0] || null;
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

                    // Guard: Never return blob, data, or internal page URLs as images
                    const lower = finalUrl.toLowerCase();
                    if (lower.startsWith('blob:') || lower.startsWith('data:')) return null;
                    if (lower.includes('//www.facebook.com') || lower.includes('//facebook.com')) return null;
                    if (lower.includes('//www.instagram.com') || lower.includes('//instagram.com')) return null;

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
                        const currentPost = findPostPermalink(media);
                        const currentSrc = media.currentSrc || media.src || '';
                        const isStale = (openBtn.__lastCurrentSrc && openBtn.__lastCurrentSrc !== currentSrc) ||
                                        (openBtn.__lastPostUrl && openBtn.__lastPostUrl !== currentPost);

                        if (openBtn.__resolvedVideoUrl && !isStale) {
                            safeSendMessage({ 
                                action: 'openInNewTab', 
                                url: openBtn.__resolvedVideoUrl, 
                                audioUrl: openBtn.__resolvedAudioUrl || null,
                                mutedUrl: openBtn.__resolvedMutedUrl || null,
                                isVideo: true, 
                                platform: platformName 
                            });
                            return;
                        }
                        getMediaUrl((url, audioUrl, mutedUrl) => {
                            if (!url) return;
                            openBtn.__resolvedVideoUrl = url;
                            openBtn.__resolvedAudioUrl = audioUrl || null;
                            openBtn.__resolvedMutedUrl = mutedUrl || null;
                            openBtn.__lastCurrentSrc = currentSrc;
                            openBtn.__lastPostUrl = currentPost;
                            safeSendMessage({ 
                                action: 'openInNewTab', 
                                url: url, 
                                audioUrl: audioUrl || null,
                                mutedUrl: mutedUrl || null,
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
                getMediaUrl((url, audioUrl, mutedUrl) => {
                    if (url) {
                        // Cache the resolved URL and show the button
                        openBtn.__resolvedVideoUrl = url;
                        openBtn.__resolvedAudioUrl = audioUrl || null;
                        openBtn.__resolvedMutedUrl = mutedUrl || null;
                        openBtn.__lastCurrentSrc = media.currentSrc || media.src || '';
                        openBtn.__lastPostUrl = findPostPermalink(media);
                        openBtn.style.display = 'flex';
                    }
                    // If no URL found, button stays hidden
                }, true); // Silent check
            };

            const findPostPermalink = (mediaEl) => {
                let cur = mediaEl;
                for (let i = 0; i < 25 && cur; i++) {
                    const link = cur.querySelector ? cur.querySelector('a[href*="/videos/"], a[href*="/watch/"], a[href*="/reel/"], a[href*="story_fbid="], a[href*="/posts/"], a[href*="fbid="], a[href*="/permalink/"]') : null;
                    if (link && link.href) return link.href;
                    cur = cur.parentElement;
                }
                const href = window.location.href;
                if (href.includes('/watch') || href.includes('/reel') || href.includes('/videos/') || href.includes('story_fbid=')) {
                    return href;
                }
                return null;
            };

            const getMediaUrl = (callback, silent = false) => {
                // Step 1: Try React Fiber extraction (works on Instagram & Facebook)
                if (isVideo) {
                    let resolved = false;
                    const handler = (e) => {
                        if (!e.data || e.data.type !== 'magic_response_react_url_' + magicId) return;
                        if (resolved) return;
                        resolved = true;
                        window.removeEventListener('message', handler);
                        if (e.data.url) {
                            let resolvedAudio = e.data.audioUrl || null;
                            const mutedUrl = e.data.mutedUrl || null;
                            if (!resolvedAudio && pageInterceptedVideoUrls.size > 0) {
                                resolvedAudio = pickBestAudioUrl(Array.from(pageInterceptedVideoUrls).slice(-5)) || pickBestAudioUrl(Array.from(pageInterceptedVideoUrls));
                            }
                            if (!resolvedAudio) {
                                safeSendMessage({ action: 'getMediaUrls', mediaType: 'audio' }, (response) => {
                                    if (response && response.audioUrls && response.audioUrls.length > 0) {
                                        resolvedAudio = pickBestAudioUrl(response.audioUrls.slice(-5)) || pickBestAudioUrl(response.audioUrls);
                                    }
                                    callback(e.data.url, resolvedAudio, mutedUrl);
                                });
                                return;
                            }
                            callback(e.data.url, resolvedAudio, mutedUrl);
                        } else {
                            if (window.location.hostname.includes('facebook.com') && isVideo) {
                                // Fallback for Facebook: ONLY attempt mobile site extraction if we have a specific video permalink
                                const postUrl = findPostPermalink(media);
                                if (postUrl) {
                                    safeSendMessage({ action: 'fetchMobileFacebookVideo', url: postUrl }, (response) => {
                                        if (response && response.url) {
                                            callback(response.url, null, null);
                                        } else {
                                            getMediaUrlFallback(callback, silent);
                                        }
                                    });
                                    return;
                                }
                            }
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
                    }, 600);
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
                        // Check if any candidate explicitly matches the post or video ID
                        let matchedVideos = [];
                        const postUrl = findPostPermalink ? findPostPermalink(media) : null;
                        const idMatch = (postUrl || window.location.href).match(/(?:videos\/|watch\/?\?v=|reel\/|posts\/|story_fbid=)(\d+)/);
                        if (idMatch && idMatch[1]) {
                            matchedVideos = platformVideos.filter(u => u.includes(idMatch[1]));
                        }

                        const targetPool = matchedVideos.length > 0 ? matchedVideos : platformVideos.slice(-5);
                        const best = pickBestVideoUrl(targetPool) || pickBestVideoUrl(platformVideos);
                        const bestAudio = pickBestAudioUrl(Array.from(pageInterceptedVideoUrls).slice(-5)) || pickBestAudioUrl(Array.from(pageInterceptedVideoUrls));
                        if (best) {
                            callback(best, bestAudio);
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
                        const bestAudio = pickBestAudioUrl(Array.from(pageInterceptedVideoUrls));
                        if (best) {
                            callback(best, bestAudio);
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
                    callback(media.currentSrc, null);
                    return;
                }

                if (media.src && !media.src.startsWith('blob:') && !media.src.startsWith('data:') && !isInternalPage(media.src)) {
                    callback(media.src, null);
                    return;
                }

                if (isVideo) {
                    const sourceTag = media.querySelector('source');
                    if (sourceTag && sourceTag.src &&
                        !sourceTag.src.startsWith('blob:') &&
                        !sourceTag.src.startsWith('data:') &&
                        !isInternalPage(sourceTag.src)) {
                        callback(sourceTag.src, null);
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
                        
                        const best = pickBestVideoUrl(candidates.slice(-5)) || pickBestVideoUrl(candidates);
                        const bestAudio = response.audioUrls && response.audioUrls.length > 0 
                            ? (pickBestAudioUrl(response.audioUrls.slice(-5)) || pickBestAudioUrl(response.audioUrls)) 
                            : (pickBestAudioUrl(candidates.slice(-5)) || pickBestAudioUrl(candidates) || (pageInterceptedVideoUrls.size > 0 ? (pickBestAudioUrl(Array.from(pageInterceptedVideoUrls).slice(-5)) || pickBestAudioUrl(Array.from(pageInterceptedVideoUrls))) : null));
                        if (best) {
                            callback(best, bestAudio);
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

                                // Invalidate cached URL when the video source or post changes (e.g. scrolling Facebook feed/reels)
                                const onMediaChange = () => {
                                    openBtn.__resolvedVideoUrl = null;
                                    openBtn.__resolvedAudioUrl = null;
                                    openBtn.__resolvedMutedUrl = null;
                                    openBtn.__lastCurrentSrc = null;
                                    openBtn.__lastPostUrl = null;
                                    preResolveVideoUrl(openBtn);
                                };
                                media.addEventListener('playing', onMediaChange);
                                media.addEventListener('loadstart', onMediaChange);
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
