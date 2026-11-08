// page_interceptor.js
// Runs in the page context. Intercepts fetch/XHR for CDN video URLs
// and exposes a React Fiber extractor for accurate per-video URL lookup.

(function () {
    'use strict';
    // Guard: prevent double-execution if loaded via both manifest and dynamic injection
    if (window.__toystallerInterceptorLoaded) return;
    window.__toystallerInterceptorLoaded = true;

    const VIDEO_KEYS = new Set([
        'video_url', 'playback_url', 'src', 'url', 'dash_manifest',
        'progressiveUrl', 'downloadUrl', 'streamingUrl', 'videoUrl',
        'progressiveStreams', 'transcodedVideoUrl',
        'playable_url', 'playable_url_quality_hd',
        'browser_native_hd_url', 'browser_native_sd_url',
        'progressive_download_url', 'video_versions',
        'hd_src', 'sd_src', 'hd_src_no_ratelimit', 'sd_src_no_ratelimit',
        'adaptiveStreams', 'mediaUrl',
        'media', 'rootUrl', 'liveVideoUrl'
    ]);

    const getPlatform = () => {
        return window.ToystallerPlatforms['facebook'] || window.ToystallerPlatform || {
            name: 'facebook',
            isValidVideo(url) {
                if (!url || typeof url !== 'string') return false;
                const lower = url.toLowerCase();
                if (lower.startsWith('blob:') || lower.startsWith('data:')) return false;
                if (lower.includes('facebook.com') || lower.includes('messenger.com')) return false;
                if (lower.includes('unified_cvc') || lower.includes('bytestart') || lower.includes('byteend')) return false;
                const isCdn = lower.includes('fbcdn.net') || lower.includes('fbsbx.com');
                const isVideoExt = lower.includes('.mp4') || lower.includes('.m4v') || lower.includes('.webm');
                return (isCdn || isVideoExt) && !lower.includes('scontent') && !lower.includes('.jpg') && !lower.includes('.png');
            },
            shouldSkipReactValue(val) {
                const lower = (val || '').toLowerCase();
                return lower.includes('facebook.com') || lower.includes('unified_cvc');
            },
            looksLikeReactVideo(val) {
                return this.isValidVideo(val);
            },
            looksLikeReactImage(val, key) {
                const lowerKey = (key || '').toLowerCase();
                const lowerVal = (val || '').toLowerCase();
                return (lowerKey.includes('image') || lowerVal.includes('scontent')) && !lowerVal.includes('.mp4');
            },
            extractPriorityReactUrl() { return null; },
            extractVideoUrlFromDOM() { return null; }
        };
    };

    function isValidVideo(url) {
        const platform = getPlatform();
        return platform.isValidVideo ? platform.isValidVideo(url) : true;
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

                if (isValidVideo(val)) {
                    found.add(val);
                }
            } else if (typeof val === 'object') {
                const platformFound = platform.extractPriorityReactUrl && platform.extractPriorityReactUrl(val, true);
                if (platformFound && isValidVideo(platformFound)) {
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

    function extractUrlsFromText(text) {
        if (!text || (!text.includes('fbcdn.net') && !text.includes('fbsbx.com') && !text.includes('playable_url') && !text.includes('browser_native_hd_url'))) return;

        // Strip Facebook "for (;;);" protection prefix if present
        let clean = text;
        if (clean.startsWith('for (;;);')) {
            clean = clean.substring(9);
        }

        const foundSet = new Set();

        // 1. Direct scan for any CDN MP4 / M4V URL
        const cdnRegex = /"(https:(?:\\\/\\\/|\/\/)[^"]+?(?:fbcdn\.net|fbsbx\.com)[^"]+?\.(?:mp4|m4v)[^"]*)"/g;
        let cdnM;
        while ((cdnM = cdnRegex.exec(clean)) !== null) {
            try {
                const url = cleanVideoUrl(JSON.parse('"' + cdnM[1] + '"'));
                if (url && isValidVideo(url)) foundSet.add(url);
            } catch(e) {
                const unescaped = cleanVideoUrl(cdnM[1]);
                if (unescaped && isValidVideo(unescaped)) foundSet.add(unescaped);
            }
        }

        // 2. Named keys scan: playable_url_quality_hd, browser_native_hd_url, etc.
        const videoRegex = /"(playable_url_quality_hd|browser_native_hd_url|playable_url|browser_native_sd_url|hd_src|progressive_download_url)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let m;
        while ((m = videoRegex.exec(clean)) !== null) {
            try {
                const url = cleanVideoUrl(JSON.parse('"' + m[2] + '"'));
                if (url && isValidVideo(url)) foundSet.add(url);
            } catch (err) {}
        }

        // 3. Try parsing JSON chunks for deep objects
        try {
            const data = JSON.parse(clean);
            findVideoUrls(data, foundSet);
        } catch(e) {
            const lines = clean.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) continue;
                try {
                    const lineData = JSON.parse(trimmed);
                    findVideoUrls(lineData, foundSet);
                } catch(err) {}
            }
        }

        if (foundSet.size > 0) {
            dispatchVideoUrls(foundSet);
        }
    }

    // --- Network Interception: Fetch ---
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (
                url.includes('facebook.com') ||
                url.includes('fbcdn.net') ||
                url.includes('graph.') ||
                url.includes('/api/graphql') ||
                url.includes('/ajax/') ||
                url.includes('graphql')
            ) {
                const clone = response.clone();
                clone.text().then(extractUrlsFromText).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    // --- Network Interception: XMLHttpRequest ---
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
                if (
                    reqUrl.includes('facebook.com') ||
                    reqUrl.includes('fbcdn.net') ||
                    reqUrl.includes('/api/graphql') ||
                    reqUrl.includes('/ajax/') ||
                    reqUrl.includes('graphql')
                ) {
                    extractUrlsFromText(this.responseText);
                }
            } catch (e) {}
        });
        return xhr;
    }
    PatchedXHR.prototype = OriginalXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;

    // --- Scan Pre-loaded HTML Scripts on Startup & Dynamic Injections ---
    function scanAllScripts() {
        const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
        for (const s of scripts) {
            const content = s.textContent;
            if (content && (content.includes('fbcdn.net') || content.includes('playable_url') || content.includes('browser_native_hd_url'))) {
                extractUrlsFromText(content);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanAllScripts);
    } else {
        scanAllScripts();
    }

    // Dynamic script watcher for BigPipe / Relay streaming scripts
    try {
        const scriptObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.tagName === 'SCRIPT' && node.textContent) {
                        extractUrlsFromText(node.textContent);
                    }
                }
            }
        });
        if (document.documentElement) {
            scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    } catch(e) {}

    // --- React Fiber Deep Traversal ---
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
            // Check priority object extractor first
            const platformFound = platform.extractPriorityReactUrl && platform.extractPriorityReactUrl(obj, isVideoContext);
            if (platformFound) {
                if (!isVideoContext || isValidVideo(platformFound)) {
                    return platformFound;
                }
            }

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
                            if (isValidVideo(val)) return val;
                        } else {
                            if (platform.looksLikeReactImage && platform.looksLikeReactImage(val, key)) {
                                return val;
                            }
                        }
                    }
                } else if (typeof val === 'object') {
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

        // 1. Traverse React Fiber properties FIRST (attached to actual playing video element)
        for (let i = 0; i < 14 && current; i++) {
            const key = Object.keys(current).find(k =>
                k.startsWith('__reactProps$') || 
                k.startsWith('__reactFiber$') || 
                k.startsWith('__reactInternalInstance$')
            );
            if (key && current[key]) {
                const found = searchObjForVideoUrl(current[key], new Set(), 0, isVideoContext);
                if (found) {
                    const clean = cleanVideoUrl(found);
                    if (!isVideoContext || isValidVideo(clean)) {
                        return clean;
                    }
                }
            }
            current = current.parentElement;
        }

        // 2. Fallback: DOM / script lookup matched to video ID
        if (isVideoContext && platform.extractVideoUrlFromDOM) {
            const domUrl = platform.extractVideoUrlFromDOM(el);
            if (domUrl) {
                const clean = cleanVideoUrl(domUrl);
                if (isValidVideo(clean)) return clean;
            }
        }

        return null;
    }

    // --- Content Script Bridge via postMessage ---
    window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'magic_get_react_url' || !e.data.id) return;
        const id = e.data.id;
        const isVideo = e.data.isVideo !== undefined ? e.data.isVideo : true;
        const el = document.querySelector(`[data-magic-id="${id}"]`);

        let url = null;
        if (el) {
            url = extractVideoUrlFromReact(el, isVideo);
        }

        // Guarantee that non-video internal URLs are never sent back for video requests
        if (isVideo && url && !isValidVideo(url)) {
            url = null;
        }

        window.postMessage({
            type: 'magic_response_react_url_' + id,
            url: url
        }, '*');
    });

})();
