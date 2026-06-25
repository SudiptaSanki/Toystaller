// content_script.js
// Finds media (videos and images) and injects download/open buttons.
// v3: Dashboard UI overlay, conditional site injection.

let toystallerBooted = false;

function bootToystaller() {
    if (toystallerBooted) return;
    toystallerBooted = true;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page_interceptor.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    injectDownloadButtons();
    setInterval(injectDownloadButtons, 1500);

    const mediaObserver = new MutationObserver(scheduleInject);
    if (document.documentElement) {
        mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
}

const pageInterceptedVideoUrls = new Set();
window.addEventListener('toystaller_video_urls', (e) => {
    if (e.detail && Array.isArray(e.detail.urls)) {
        e.detail.urls.forEach(url => pageInterceptedVideoUrls.add(url));
    }
});

function triggerDownload(url) {
    chrome.runtime.sendMessage({ action: 'downloadMedia', url: url }, (response) => {
        if (!response || !response.success) {
            console.error("Download failed or was rejected.");
        }
    });
}

function scoreVideoUrl(url) {
    let score = 0;
    const lower = url.toLowerCase();
    if (lower.includes('.mp4') || lower.includes('.m4v')) score += 10;
    if (lower.includes('.m3u8') || lower.includes('.mpd')) score -= 5;
    if (lower.includes('bytestart') || lower.includes('byteend')) score -= 20;
    if (lower.includes('1080') || lower.includes('720')) score += 5;
    if (lower.includes('480') || lower.includes('360')) score += 2;
    score += Math.min(url.length / 100, 5);
    return score;
}

function pickBestVideoUrl(urls) {
    if (!urls || urls.length === 0) return null;
    const sorted = [...urls].sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
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

const PlatformManager = {
    getPlatform() {
        const host = window.location.hostname.toLowerCase();
        if (host.includes('instagram.com')) return this.instagram;
        if (host.includes('linkedin.com')) return this.linkedin;
        return this.generic;
    },

    instagram: {
        name: 'instagram',
        getContext() {
            const path = window.location.pathname.toLowerCase();
            if (path === '/' || path === '') return 'ig-home';
            if (path.includes('/direct/')) return 'ig-dm';
            if (path.includes('/reels/') || path.includes('/reel/')) return 'ig-reels';
            if (path.includes('/stories/')) return 'ig-stories';
            if (path.includes('/p/')) return 'ig-post-modal';
            return 'ig-profile';
        },
        hasActiveModal() {
            return document.querySelector('[role="dialog"]') !== null;
        },
        isInsideModal(media) {
            const dialogs = document.querySelectorAll('[role="dialog"]');
            for (const dialog of dialogs) {
                if (dialog.contains(media)) return true;
            }
            return false;
        },
        isThumbnail(media) {
            if (media.tagName.toLowerCase() !== 'img') return false;
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width;
            const naturalH = media.naturalHeight || media.height;
            if (naturalW >= 200 && naturalH >= 200) return false;
            if (naturalW < 100 || naturalH < 100) return true;
            if (rect.width < 100 || rect.height < 100) return true;
            
            const path = window.location.pathname.toLowerCase();
            if (path.includes('/direct/')) {
                if (rect.width < 180 || rect.height < 180) return true;
                if (media.closest('[role="button"]') && rect.width < 60) return true;
            }
            
            const role = (media.getAttribute('role') || '').toLowerCase();
            if (role === 'presentation' || role === 'none') return true;
            const parent = media.closest('button, a, [role="button"], nav, header');
            if (parent && (rect.width < 160 || rect.height < 160)) return true;
            return false;
        },
        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (window.location.pathname.toLowerCase().includes('/direct/')) return 0.75;
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        }
    },

    linkedin: {
        name: 'linkedin',
        getContext() {
            const path = window.location.pathname.toLowerCase();
            if (path.includes('/messaging/')) return 'li-messaging';
            if (path.includes('/jobs/')) return 'li-jobs';
            if (path.includes('/learning/')) return 'li-learning';
            return 'li-feed';
        },
        hasActiveModal() {
            return document.querySelector('.artdeco-modal') !== null || document.querySelector('#artdeco-modal-outlet > *') !== null;
        },
        isInsideModal(media) {
            return media.closest('.artdeco-modal') !== null || media.closest('#artdeco-modal-outlet') !== null;
        },
        isThumbnail(media) {
            if (media.tagName.toLowerCase() !== 'img') return false;
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width;
            const naturalH = media.naturalHeight || media.height;
            if (naturalW >= 200 && naturalH >= 200) return false;
            if (naturalW < 100 || naturalH < 100) return true;
            if (rect.width < 100 || rect.height < 100) return true;
            
            // Ignore avatars and small UI images
            if (media.closest('.presence-entity') || media.closest('.ivm-image-view-model') || media.closest('.update-components-actor')) {
                if (rect.width < 150) return true;
            }
            return false;
        },
        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        }
    },

    generic: {
        name: 'generic',
        getContext() { return 'generic'; },
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
        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        }
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
                `;

                const iconSize = Math.round(16 * scale);

                const openBtn = document.createElement('button');
                openBtn.className = 'magic-open-btn';
                openBtn.title = isVideo ? 'Open video in new tab' : 'Open image in new tab';
                openBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
                openBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');
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
                    getMediaUrl((url) => {
                        chrome.runtime.sendMessage({ action: 'openInNewTab', url: url });
                    });
                });
                buttons.push(openBtn);

                if (!isVideo) {
                    const dlBtn = document.createElement('button');
                    dlBtn.className = 'magic-dl-btn';
                    dlBtn.title = 'Download image';
                    dlBtn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
                    dlBtn.style.cssText = makeBtnStyle('rgba(30,30,30,0.75)');
                    dlBtn.addEventListener('mouseenter', () => {
                        dlBtn.style.opacity = '1';
                        dlBtn.style.backgroundColor = 'rgba(231, 76, 60, 0.95)';
                    });
                    dlBtn.addEventListener('mouseleave', () => {
                        dlBtn.style.opacity = '0.55';
                        dlBtn.style.backgroundColor = 'rgba(30,30,30,0.75)';
                    });
                    dlBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        getMediaUrl((url) => triggerDownload(url));
                    });
                    buttons.push(dlBtn);
                }

                return buttons;
            };

            const getMediaUrl = async (callback) => {
                if (isVideo) {
                    try {
                        const reactUrl = await new Promise((resolve) => {
                            const handler = (e) => {
                                window.removeEventListener('magic_response_react_url_' + magicId, handler);
                                resolve(e.detail.url);
                            };
                            window.addEventListener('magic_response_react_url_' + magicId, handler);
                            window.dispatchEvent(new CustomEvent('magic_get_react_url', { detail: { id: magicId } }));

                            setTimeout(() => {
                                window.removeEventListener('magic_response_react_url_' + magicId, handler);
                                resolve(null);
                            }, 300);
                        });

                        if (reactUrl) {
                            callback(reactUrl);
                            return;
                        }
                    } catch (e) {}
                }

                const getFilename = (urlStr) => {
                    try {
                        const parts = new URL(urlStr).pathname.split('/');
                        const name = parts.pop();
                        return (name && name.length > 5) ? name : null;
                    } catch (e) { return null; }
                };

                const currentFilename = getFilename(media.currentSrc || media.src);

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
                    !media.currentSrc.startsWith('data:')) {
                    callback(media.currentSrc);
                    return;
                }

                if (media.src && !media.src.startsWith('blob:') && !media.src.startsWith('data:')) {
                    callback(media.src);
                    return;
                }

                if (isVideo) {
                    const sourceTag = media.querySelector('source');
                    if (sourceTag && sourceTag.src &&
                        !sourceTag.src.startsWith('blob:') &&
                        !sourceTag.src.startsWith('data:')) {
                        callback(sourceTag.src);
                        return;
                    }
                }

                const mediaType = isVideo ? 'video' : 'img';
                chrome.runtime.sendMessage({ action: 'getMediaUrls', mediaType: mediaType }, (response) => {
                    if (response && response.urls && response.urls.length > 0) {
                        const best = pickBestVideoUrl(response.urls);
                        if (best) {
                            callback(best);
                            return;
                        }
                    }
                    alert('Could not find the video URL yet.\n\nTip: Make sure the video has started playing, then click the button again.');
                });
            };

            if (window.magicOverlayManager) {
                window.magicOverlayManager.addOverlay(media, createButtonsFn);
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

const defaultAllowed = ['instagram.com', 'linkedin.com'];
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

    chrome.storage.local.get({ globalEnabled: false, allowedSites: ['instagram.com', 'linkedin.com'] }, (result) => {
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
                    <h2>Toystaller v3</h2>
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
                
                <button class="btn" id="reloadBtn" style="display: none;">Reload Page to Apply</button>
            </div>
        `;

        shadow.getElementById('closeBtn').addEventListener('click', toggleDashboardOverlay);

        const reloadBtn = shadow.getElementById('reloadBtn');
        const showReload = () => { reloadBtn.style.display = 'block'; };

        shadow.getElementById('siteToggle').addEventListener('change', (e) => {
            const checked = e.target.checked;
            chrome.storage.local.get({ allowedSites: ['instagram.com', 'linkedin.com'] }, (res) => {
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

        reloadBtn.addEventListener('click', () => window.location.reload());
    });
}
