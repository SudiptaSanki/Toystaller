// content_script.js
// Specialized LinkedIn Media Extractor & Button Injector.
// Supports: Feed, Profiles, Articles, Modals, and Messaging.

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
    if (lower.includes('/audio') || lower.includes('audio')) score -= 1000;
    if (lower.includes('.mp4') || lower.includes('.m4v')) score += 50; // Progressive MP4 preferred
    if (lower.includes('playlist/vid')) score += 20; // HLS / playlist stream
    if (lower.includes('.mpd') || lower.includes('/manifest/') || lower.includes('stream_type=dash')) score -= 50;
    if (lower.includes('bytestart') || lower.includes('byteend')) score -= 50;

    if (lower.includes('1080')) score += 20;
    else if (lower.includes('720')) score += 10;
    else if (lower.includes('480')) score += 5;
    else if (lower.includes('360')) score += 2;

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
        if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash') || lower.includes('manifest')) return false;
        if (lower.includes('/audio') || lower.includes('audio')) return false;
        return true;
    });
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

function getActivePlatform() {
    return window.ToystallerActivePlatform || (window.ToystallerPlatforms && window.ToystallerPlatforms['linkedin']) || {
        name: 'LinkedIn',
        version: 'v1.0',
        hasActiveModal() { return false; },
        isInsideModal() { return false; },
        isThumbnail() { return false; },
        getButtonScale() { return 1; },
        filterBackgroundUrls(candidates) { return candidates; },
        useDirectDownload: false,
        isInternalUrl() { return false; }
    };
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

                    // Platform-specific URL upgrading (LinkedIn high-res)
                    if (platform.upgradeImageUrl) {
                        finalUrl = platform.upgradeImageUrl(finalUrl);
                    }

                    if (finalUrl) {
                        const lower = finalUrl.toLowerCase();
                        if (lower.startsWith('blob:') || lower.startsWith('data:')) return null;
                        if (platform.isInternalUrl && platform.isInternalUrl(finalUrl)) return null;
                    }

                    return finalUrl;
                };

                // Blue Button: Open Video (in Anti-Redirect Player) or Image in new tab
                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open video in player' : 'Open image in new tab';
                openBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');

                openBtn.addEventListener('mouseenter', () => {
                    openBtn.style.opacity = '1';
                    openBtn.style.backgroundColor = 'rgba(10, 102, 194, 0.95)';
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
                                const finalUrl = platform.upgradeImageUrl ? platform.upgradeImageUrl(ev.data.url) : ev.data.url;
                                safeSendMessage({ action: 'openInNewTab', url: finalUrl, isVideo: false });
                            } else {
                                safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl(), isVideo: false });
                            }
                        };
                        window.addEventListener('message', handler);
                        window.postMessage({ type: 'magic_get_react_url', id: imgMagicId, isVideo: false }, '*');
                        setTimeout(() => {
                            if (resolved) return;
                            resolved = true;
                            window.removeEventListener('message', handler);
                            safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl(), isVideo: false });
                        }, 250);
                    } else {
                        // Video: resolve best URL and open in new tab (routed to player)
                        if (openBtn.__resolvedVideoUrl) {
                            safeSendMessage({ action: 'openInNewTab', url: openBtn.__resolvedVideoUrl, isVideo: true });
                            return;
                        }

                        openBtn.style.opacity = '1';
                        openBtn.style.backgroundColor = 'rgba(10, 102, 194, 0.95)';

                        getMediaUrl((url) => {
                            openBtn.style.opacity = '0.55';
                            openBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                            if (url) {
                                openBtn.__resolvedVideoUrl = url;
                                safeSendMessage({ action: 'openInNewTab', url: url, isVideo: true });
                            } else {
                                alert('Could not resolve video URL. If the video is paused, please click play and try again.');
                            }
                        }, false);
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
                                    safeSendMessage({ action: 'openInNewTab', url: url, isVideo: false });
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
                                    safeSendMessage({ action: 'openInNewTab', url: ev.data.url, isVideo: false });
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
                            }, 350);
                            return;
                        }

                        if (poster) {
                            safeSendMessage({ action: 'openInNewTab', url: poster, isVideo: false });
                        } else {
                            alert('No thumbnail image available for this video.');
                        }
                    } else {
                        safeSendMessage({ action: 'openInNewTab', url: getHighResImageUrl(), isVideo: false });
                    }
                });
                buttons.push(imgBtn);

                return buttons;
            };

            const preResolveVideoUrl = (openBtn) => {
                if (!isVideo) return;
                getMediaUrl((url) => {
                    if (url) {
                        openBtn.__resolvedVideoUrl = url;
                    }
                }, true);
            };

            const getMediaUrl = (callback, silent = false) => {
                if (isVideo) {
                    // 1. Try DOM extraction first (LinkedIn provides progressive MP4s directly in data-sources)
                    if (platform.extractVideoUrlFromDOM) {
                        const domUrl = platform.extractVideoUrlFromDOM(media);
                        if (domUrl) {
                            callback(domUrl.split('#')[0]);
                            return;
                        }
                    }

                    // 2. Try React Fiber extraction
                    let resolved = false;
                    const handler = (e) => {
                        if (!e.data || e.data.type !== 'magic_response_react_url_' + magicId) return;
                        if (resolved) return;
                        resolved = true;
                        window.removeEventListener('message', handler);
                        if (e.data.url) {
                            callback(e.data.url.split('#')[0]);
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
                // Priority check: DOM sources attribute on/around media
                if (isVideo && platform.extractVideoUrlFromDOM) {
                    const domUrl = platform.extractVideoUrlFromDOM(media);
                    if (domUrl) {
                        callback(domUrl.split('#')[0]);
                        return;
                    }
                }

                const currentSrc = media.currentSrc || media.src || '';
                const isBlobSource = currentSrc.startsWith('blob:') || currentSrc.startsWith('data:');

                if (isVideo && isBlobSource && pageInterceptedVideoUrls.size > 0) {
                    const platformVideos = platform.filterBackgroundUrls ? platform.filterBackgroundUrls(Array.from(pageInterceptedVideoUrls), true) : Array.from(pageInterceptedVideoUrls);

                    if (platformVideos.length > 0) {
                        const best = pickBestVideoUrl(platformVideos);
                        if (best) {
                            callback(best.split('#')[0]);
                            return;
                        }
                    }
                }

                if (currentSrc && !isBlobSource && (!platform.isInternalUrl || !platform.isInternalUrl(currentSrc))) {
                    callback(currentSrc.split('#')[0]);
                    return;
                }

                const sources = media.querySelectorAll('source');
                for (let source of sources) {
                    const src = source.src;
                    if (src && !src.startsWith('blob:') && !src.startsWith('data:') && (!platform.isInternalUrl || !platform.isInternalUrl(src))) {
                        callback(src.split('#')[0]);
                        return;
                    }
                }

                if (isVideo) {
                    safeSendMessage({ action: 'getMediaUrls', mediaType: 'video' }, (response) => {
                        if (response && response.urls && response.urls.length > 0) {
                            const platformVideos = platform.filterBackgroundUrls ? platform.filterBackgroundUrls(response.urls, true) : response.urls;
                            const best = pickBestVideoUrl(platformVideos);
                            if (best) {
                                callback(best.split('#')[0]);
                                return;
                            }
                        }

                        if (currentSrc && !isBlobSource) {
                            callback(currentSrc.split('#')[0]);
                            return;
                        }

                        if (!silent) {
                            alert('Could not find video URL. The video may still be buffering or use an unsupported streaming format.');
                        }
                    });
                    return;
                }

                const fallbackUrl = media.currentSrc || media.src;
                if (fallbackUrl && (!platform.isInternalUrl || !platform.isInternalUrl(fallbackUrl))) {
                    callback(fallbackUrl.split('#')[0]);
                } else if (!silent) {
                    alert('Could not find a valid media URL to open.');
                }
            };

            window.magicOverlayManager.addOverlay(media, createButtonsFn);

            if (isVideo) {
                const entry = window.magicOverlayManager.overlays.get(media);
                if (entry && entry.container) {
                    const openBtn = entry.container.querySelector('.magic-open-btn');
                    if (openBtn) {
                        preResolveVideoUrl(openBtn);

                        if (!openBtn.__resolvedVideoUrl) {
                            const onCanPlay = () => {
                                preResolveVideoUrl(openBtn);
                                media.removeEventListener('canplay', onCanPlay);
                                media.removeEventListener('playing', onCanPlay);
                            };
                            media.addEventListener('canplay', onCanPlay);
                            media.addEventListener('playing', onCanPlay);
                        }
                    }
                }
            }
        }
    });
}

let injectDebounce = null;
function scheduleInject() {
    clearTimeout(injectDebounce);
    injectDebounce = setTimeout(() => {
        injectDownloadButtons();
    }, 150);
}

let toystallerBooted = false;

function bootToystaller(platformScripts, routerCode) {
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
    setInterval(injectDownloadButtons, 1200);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

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
                margin-bottom: 16px;
            }
            .header h2 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                background: linear-gradient(135deg, #0a66c2 0%, #70b5f9 100%);
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
                border-left: 3px solid #0a66c2;
            }
        </style>

        <div class="dashboard">
            <div class="header">
                <h2>Toystaller ${platform.version || 'v1.0'} — ${platform.name || 'LinkedIn'}</h2>
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


bootToystaller([
    'platforms/linkedin.js',
    'page_interceptor.js'
]);
