// page_interceptor.js
// Runs in the MAIN page world. Intercepts fetch/XHR for CDN video URLs
// and exposes a React Fiber extractor for accurate per-video URL lookup.
// Platform-specific behavior is delegated to window.ToystallerPlatform.

(function () {
    'use strict';
    if (window.__toystallerInterceptorLoaded) return;
    window.__toystallerInterceptorLoaded = true;

    // The active platform object — set by platform.js before this file loads.
    // Falls back to a no-op generic if not set.
    const getPlatform = () => {
        return window.ToystallerPlatform || {
            name: 'generic',
            shouldSkipReactValue() { return false; },
            looksLikeReactVideo(val) { return val.toLowerCase().includes('.mp4'); },
            looksLikeReactImage(val, key) { return key.toLowerCase().includes('image') || val.toLowerCase().includes('.jpg'); },
            extractPriorityReactUrl() { return null; },
            extractVideoUrlFromDOM() { return null; },
            isValidVideo() { return true; },
            getInterceptUrls() { return []; }
        };
    };

    // --- Network Interception: Scan JSON responses for video URLs ---

    function findVideoUrls(obj, found = new Set(), depth = 0) {
        if (depth > 12 || !obj || typeof obj !== 'object') return found;
        const platform = getPlatform();

        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string') {
                const isHttp = val.startsWith('https://') || val.startsWith('http://');
                if (!isHttp || val.includes('blob:')) continue;

                if (platform.shouldSkipReactValue && platform.shouldSkipReactValue(val, key, true)) {
                    continue;
                }

                const looksLikeVideo = platform.looksLikeReactVideo && platform.looksLikeReactVideo(val, key);
                const looksLikeImage = platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);

                if (looksLikeVideo && !looksLikeImage && !val.toLowerCase().includes('bytestart')) {
                    found.add(val);
                }
            } else if (typeof val === 'object') {
                const platformFound = platform.extractPriorityReactUrl && platform.extractPriorityReactUrl(val, true);
                if (platformFound) {
                    found.add(platformFound);
                }
                findVideoUrls(val, found, depth + 1);
            }
        }
        return found;
    }

    function dispatchVideoUrls(urls) {
        if (!urls || urls.size === 0) return;
        window.postMessage({
            type: 'toystaller_video_urls',
            urls: Array.from(urls)
        }, '*');
    }

    // Get the list of URL patterns to intercept from the platform
    const getInterceptPatterns = () => {
        const platform = getPlatform();
        return platform.getInterceptUrls ? platform.getInterceptUrls() : [];
    };

    const shouldIntercept = (url) => {
        const patterns = getInterceptPatterns();
        if (patterns.length === 0) return false;
        return patterns.some(pattern => url.includes(pattern));
    };

    // Patch fetch()
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (shouldIntercept(url)) {
                const clone = response.clone();
                clone.json().then(data => {
                    const foundVideos = findVideoUrls(data);
                    dispatchVideoUrls(foundVideos);
                }).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    // Patch XMLHttpRequest
    const OriginalXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open.bind(xhr);
        let reqUrl = '';
        xhr.open = function (method, url, ...rest) {
            reqUrl = url || '';
            return originalOpen(method, url, ...rest);
        };
        xhr.addEventListener('load', function () {
            try {
                if (shouldIntercept(reqUrl)) {
                    const data = JSON.parse(this.responseText);
                    const foundVideos = findVideoUrls(data);
                    dispatchVideoUrls(foundVideos);
                }
            } catch (e) {}
        });
        return xhr;
    }
    PatchedXHR.prototype = OriginalXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;

    // --- React Fiber Extraction ---

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

                        if (isVideoContext) {
                            const isVideo = platform.looksLikeReactVideo && platform.looksLikeReactVideo(val, key);
                            const isImage = platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);
                            if (isVideo && !isImage && !val.toLowerCase().includes('bytestart')) {
                                return val;
                            }
                        } else {
                            const isImage = platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);
                            if (isImage) {
                                return val;
                            }
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

    // --- Message handler for content script requests ---

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
