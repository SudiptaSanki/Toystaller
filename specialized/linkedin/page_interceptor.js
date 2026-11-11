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

    // --- React Fiber Extraction & Hierarchy Walk ---

    function scoreVideoUrl(url) {
        if (!url || typeof url !== 'string') return 0;
        const lower = url.toLowerCase();
        let score = 0;
        if (lower.includes('1080p') || lower.includes('1080')) score += 10800000;
        else if (lower.includes('720p') || lower.includes('720')) score += 7200000;
        else if (lower.includes('640p') || lower.includes('640')) score += 6400000;
        else if (lower.includes('480p') || lower.includes('480')) score += 4800000;
        else if (lower.includes('360p') || lower.includes('360')) score += 3600000;
        if (lower.includes('.mp4')) score += 500000;
        return score;
    }

    function searchObjForVideoUrl(obj, seen = new Set(), depth = 0, isVideoContext = true) {
        if (depth > 10 || !obj || typeof obj !== 'object') return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        const platform = getPlatform();

        if (Array.isArray(obj)) {
            let bestUrl = null;
            let maxScore = -1;
            for (let item of obj) {
                const res = searchObjForVideoUrl(item, seen, depth + 1, isVideoContext);
                if (res) {
                    const s = scoreVideoUrl(res);
                    if (s > maxScore || !bestUrl) {
                        maxScore = s;
                        bestUrl = res;
                    }
                }
            }
            if (bestUrl) return bestUrl;
        } else {
            // Check direct priority video properties
            const priorityKeys = ['sources', 'streamingLocations', 'videoUrl', 'playbackLocations', 'progressiveDownloadUrl', 'mp4Url', 'src', 'url'];
            for (let key of priorityKeys) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('http') && !val.includes('blob:')) {
                    if (isValidVideo(val)) return val;
                } else if (typeof val === 'object' && val) {
                    const nested = searchObjForVideoUrl(val, seen, depth + 1, isVideoContext);
                    if (nested) return nested;
                }
            }

            for (let key of Object.keys(obj)) {
                if (key === 'return' || key === 'sibling' || key === 'child' || key === '_owner' || key === 'stateNode' || priorityKeys.includes(key)) continue;

                const val = obj[key];
                if (typeof val === 'string') {
                    const isHttp = val.startsWith('https://') || val.startsWith('http://');
                    if (isHttp && !val.includes('blob:') && !val.includes('bytestart')) {
                        if (platform.shouldSkipReactValue && platform.shouldSkipReactValue(val, key, isVideoContext)) {
                            continue;
                        }

                        if (isVideoContext) {
                            const isVideo = platform.looksLikeReactVideo && platform.looksLikeReactVideo(val, key);
                            const isImage = platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);
                            if (isVideo && !isImage) return val;
                        } else {
                            const isImage = platform.looksLikeReactImage && platform.looksLikeReactImage(val, key);
                            if (isImage) return val;
                        }
                    }
                } else if (typeof val === 'object') {
                    const platformFound = platform.extractPriorityReactUrl && platform.extractPriorityReactUrl(val, isVideoContext);
                    if (platformFound) return platformFound;
                    const nested = searchObjForVideoUrl(val, seen, depth + 1, isVideoContext);
                    if (nested) return nested;
                }
            }
        }
        return null;
    }

    function extractVideoUrlFromFiberTree(el, isVideoContext = true) {
        if (!el) return null;

        const fiberKey = Object.keys(el).find(k =>
            k.startsWith('__reactFiber$') ||
            k.startsWith('__reactInternalInstance$')
        );
        let fiber = fiberKey ? el[fiberKey] : null;

        let bestUrl = null;
        let maxScore = -1;
        let depth = 0;

        while (fiber && depth < 45) {
            if (fiber.memoizedProps) {
                const found = searchObjForVideoUrl(fiber.memoizedProps, new Set(), 0, isVideoContext);
                if (found) {
                    const s = scoreVideoUrl(found);
                    if (s > maxScore || !bestUrl) { maxScore = s; bestUrl = found; }
                    if (s >= 7000000) break; // Found 720p or 1080p HD
                }
            }
            if (fiber.memoizedState) {
                const found = searchObjForVideoUrl(fiber.memoizedState, new Set(), 0, isVideoContext);
                if (found) {
                    const s = scoreVideoUrl(found);
                    if (s > maxScore || !bestUrl) { maxScore = s; bestUrl = found; }
                    if (s >= 7000000) break;
                }
            }
            if (fiber.pendingProps) {
                const found = searchObjForVideoUrl(fiber.pendingProps, new Set(), 0, isVideoContext);
                if (found) {
                    const s = scoreVideoUrl(found);
                    if (s > maxScore || !bestUrl) { maxScore = s; bestUrl = found; }
                    if (s >= 7000000) break;
                }
            }
            fiber = fiber.return;
            depth++;
        }

        return bestUrl;
    }

    function extractVideoUrlFromReact(el, isVideoContext = true) {
        const platform = getPlatform();

        // 1. Try DOM extraction first (data-sources on container)
        if (platform.extractVideoUrlFromDOM) {
            const domUrl = platform.extractVideoUrlFromDOM(el);
            if (domUrl) return domUrl;
        }

        // 2. Deep React Fiber walk up 45 components
        if (el) {
            const fiberUrl = extractVideoUrlFromFiberTree(el, isVideoContext);
            if (fiberUrl) return fiberUrl;
        }

        // 3. Check nearest child video if el was a wrapper
        if (el && el.querySelector) {
            const childVid = el.querySelector('video');
            if (childVid) {
                const childFiberUrl = extractVideoUrlFromFiberTree(childVid, isVideoContext);
                if (childFiberUrl) return childFiberUrl;
            }
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
