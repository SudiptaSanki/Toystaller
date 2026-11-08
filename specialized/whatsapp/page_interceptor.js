// page_interceptor.js
// Runs in the MAIN page world (web.whatsapp.com).
// Features:
// 1. Intercepts window.URL.createObjectURL to register all decrypted WhatsApp media blobs.
// 2. Direct browser downloader: triggers anchor-click downloads from the main page context.
// 3. Media reader: converts decrypted blobs to Base64 Data URLs for dedicated viewer tabs.
// 4. Intercepts fetch/XHR and React Fiber for media resolution.

(function () {
    'use strict';
    if (window.__toystallerInterceptorLoaded) return;
    window.__toystallerInterceptorLoaded = true;

    // --- 1. Blob Interception Registry ---
    const blobCache = new Map(); // url -> { blob, mimeType, timestamp }
    const originalCreateObjectURL = window.URL.createObjectURL;

    window.URL.createObjectURL = function (obj) {
        const url = originalCreateObjectURL.call(this, obj);
        try {
            if (obj instanceof Blob) {
                blobCache.set(url, { blob: obj, mimeType: obj.type, timestamp: Date.now() });
                // Keep cache bounded to last 60 media items
                if (blobCache.size > 60) {
                    const oldestKey = blobCache.keys().next().value;
                    blobCache.delete(oldestKey);
                }
            }
        } catch (e) {}
        return url;
    };

    // Helper: locate active status media directly in the DOM
    function findActiveStatusMediaDOM() {
        const statusContainer = document.querySelector(`
            [data-animate-status-v3="true"],
            div[data-testid="status-v3-main"],
            div[data-testid="status-viewer"],
            div[data-testid="media-viewer"],
            div[aria-label*="Status" i],
            div[aria-label*="Story" i],
            div[role="dialog"]
        `);

        if (statusContainer) {
            const video = statusContainer.querySelector('video');
            if (video && (video.currentSrc || video.src)) return video;

            const imgs = Array.from(statusContainer.querySelectorAll('img'));
            const validImgs = imgs.filter(img => {
                const r = img.getBoundingClientRect();
                return r.width >= 100 && r.height >= 100 && !img.src.includes('avatar') && !img.src.includes('profile');
            });
            if (validImgs.length > 0) {
                return validImgs.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
            }
        }

        // Global fallback: any visible video
        const videos = Array.from(document.querySelectorAll('video'));
        const activeVideo = videos.find(v => {
            const r = v.getBoundingClientRect();
            return r.width > 150 && r.height > 150 && (v.currentSrc || v.src);
        });
        if (activeVideo) return activeVideo;

        return null;
    }

    // --- 2. Main-World Media Downloader & Reader ---
    window.addEventListener('message', async (e) => {
        if (!e.data || e.data.type !== 'toystaller_main_media_request') return;

        let { action, url, isVideo, filename, requestId } = e.data;

        // If URL wasn't found or is empty, try detecting from active status DOM
        if (!url) {
            const activeEl = findActiveStatusMediaDOM();
            if (activeEl) {
                url = activeEl.currentSrc || activeEl.src || '';
                if (activeEl.tagName.toLowerCase() === 'video') isVideo = true;
            }
        }

        // Resolve blob object from memory cache or main-world fetch
        let blob = null;
        if (url && blobCache.has(url)) {
            blob = blobCache.get(url).blob;
        }

        if (!blob && url && (url.startsWith('blob:') || url.startsWith('http'))) {
            try {
                const res = await window.fetch(url);
                blob = await res.blob();
            } catch (fetchErr) {
                console.warn('Toystaller: Main-world fetch failed:', fetchErr);
            }
        }

        const ext = isVideo ? 'mp4' : 'jpg';
        const finalFilename = filename || `whatsapp_${isVideo ? 'video' : 'image'}_${Date.now()}.${ext}`;

        // Handler: DIRECT DOWNLOAD
        if (action === 'download') {
            try {
                const downloadUrl = blob ? originalCreateObjectURL.call(window.URL, blob) : url;
                if (downloadUrl) {
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = downloadUrl;
                    a.download = finalFilename;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        a.remove();
                        if (blob) window.URL.revokeObjectURL(downloadUrl);
                    }, 4000);

                    window.postMessage({
                        type: 'toystaller_main_media_response',
                        requestId: requestId,
                        success: true,
                        action: 'download',
                        filename: finalFilename
                    }, '*');
                    return;
                }
            } catch (dlErr) {
                console.error('Toystaller: Direct download failed:', dlErr);
            }

            window.postMessage({
                type: 'toystaller_main_media_response',
                requestId: requestId,
                success: false,
                action: 'download'
            }, '*');
            return;
        }

        // Handler: OPEN IN NEW TAB (convert blob to base64 Data URL)
        if (action === 'open') {
            if (blob) {
                try {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        window.postMessage({
                            type: 'toystaller_main_media_response',
                            requestId: requestId,
                            success: true,
                            action: 'open',
                            dataUrl: reader.result,
                            mimeType: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
                            isVideo: isVideo,
                            filename: finalFilename
                        }, '*');
                    };
                    reader.readAsDataURL(blob);
                    return;
                } catch (readErr) {
                    console.error('Toystaller: FileReader error:', readErr);
                }
            }

            // Fallback: If blob conversion fails, trigger direct download so user doesn't miss media
            if (url) {
                try {
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = finalFilename;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => a.remove(), 2000);
                } catch (e2) {}
            }

            window.postMessage({
                type: 'toystaller_main_media_response',
                requestId: requestId,
                success: false,
                action: 'open'
            }, '*');
        }
    });

    // --- 3. React Fiber & DOM Extraction ---
    const getPlatform = () => {
        return window.ToystallerPlatform || {
            name: 'generic',
            shouldSkipReactValue() { return false; },
            looksLikeReactVideo(val) { return val.toLowerCase().includes('.mp4'); },
            looksLikeReactImage(val, key) { return key.toLowerCase().includes('image') || val.toLowerCase().includes('.jpg'); },
            extractPriorityReactUrl() { return null; },
            extractVideoUrlFromDOM(el) { return el && (el.currentSrc || el.src); },
            isValidVideo() { return true; },
            getInterceptUrls() { return []; }
        };
    };

    function searchObjForVideoUrl(obj, seen = new Set(), depth = 0, isVideoContext = true) {
        if (depth > 12 || !obj || typeof obj !== 'object') return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        const platform = getPlatform();

        if (Array.isArray(obj)) {
            for (let item of obj) {
                const res = searchObjForVideoUrl(item, seen, depth + 1, isVideoContext);
                if (res) return res;
            }
        } else {
            for (let key of Object.keys(obj)) {
                if (key === 'return' || key === 'sibling' || key === '_owner' || key === 'parent') continue;

                const val = obj[key];
                if (typeof val === 'string') {
                    const isHttp = val.startsWith('https://') || val.startsWith('http://');
                    if (isHttp && !val.includes('blob:')) {
                        if (platform.shouldSkipReactValue && platform.shouldSkipReactValue(val, key, isVideoContext)) {
                            continue;
                        }

                        const looksLikeImage = !isVideoContext && platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);
                        const looksLikeVideo = isVideoContext && platform.looksLikeReactVideo && platform.looksLikeReactVideo(val, key);

                        if (looksLikeImage || looksLikeVideo) {
                            return val;
                        }
                    }
                } else if (typeof val === 'object') {
                    const platformFound = platform.extractPriorityReactUrl && platform.extractPriorityReactUrl(val, isVideoContext);
                    if (platformFound) {
                        return platformFound;
                    }
                    const nested = searchObjForVideoUrl(val, seen, depth + 1, isVideoContext);
                    if (nested) return nested;
                }
            }
        }
        return null;
    }

    function extractVideoUrlFromReact(el, isVideoContext = true) {
        let current = el;
        const platform = getPlatform();

        if (platform.extractVideoUrlFromDOM) {
            const domUrl = platform.extractVideoUrlFromDOM(el);
            if (domUrl) return domUrl;
        }

        for (let i = 0; i < 12 && current; i++) {
            const key = Object.keys(current).find(k => k.startsWith('__reactProps$') ||
                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (key && current[key]) {
                const found = searchObjForVideoUrl(current[key], new Set(), 0, isVideoContext);
                if (found) return found;
            }
            current = current.parentElement;
        }

        return null;
    }

    window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'magic_get_react_url' || !e.data.id) return;
        const id = e.data.id;
        const isVideo = e.data.isVideo !== undefined ? e.data.isVideo : true;
        const el = document.querySelector(`[data-magic-id="${id}"]`);

        let url = null;
        if (el) {
            url = extractVideoUrlFromReact(el, isVideo);
        }

        window.postMessage({
            type: 'magic_response_react_url_' + id,
            url: url
        }, '*');
    });

})();
