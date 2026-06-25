// page_interceptor.js
// Runs in the page context. Intercepts fetch/XHR for CDN video URLs
// and exposes a React Fiber extractor for accurate per-video URL lookup.

(function () {
    'use strict';

    const VIDEO_KEYS = new Set([
        'video_url', 'playback_url', 'src', 'url', 'dash_manifest',
        'progressiveUrl', 'downloadUrl', 'streamingUrl', 'videoUrl',
        'progressiveStreams', 'transcodedVideoUrl'
    ]);

    function findVideoUrls(obj, found = new Set(), depth = 0) {
        if (depth > 12 || !obj || typeof obj !== 'object') return found;
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string') {
                const isHttp = val.startsWith('https://') || val.startsWith('http://');
                if (!isHttp || val.includes('blob:')) continue;

                const lower = val.toLowerCase();
                const lowerKey = key.toLowerCase();
                const isVideoKey = VIDEO_KEYS.has(key) ||
                                   lowerKey.includes('video') ||
                                   lowerKey.includes('stream') ||
                                   lowerKey.includes('playback');

                const looksLikeVideo =
                    isVideoKey ||
                    lower.includes('.mp4') ||
                    lower.includes('.m4v') ||
                    lower.includes('.webm') ||
                    (lower.includes('fbcdn.net') && lower.includes('video')) ||
                    (lower.includes('cdninstagram.com') && lower.includes('video')) ||
                    (lower.includes('licdn.com') && (lower.includes('video') || lower.includes('playlist')));

                if (looksLikeVideo) {
                    found.add(val);
                }
            } else if (typeof val === 'object') {
                findVideoUrls(val, found, depth + 1);
            }
        }
        return found;
    }

    function dispatchVideoUrls(urls) {
        if (!urls || urls.size === 0) return;
        window.dispatchEvent(new CustomEvent('toystaller_video_urls', {
            detail: { urls: Array.from(urls) }
        }));
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (
                url.includes('instagram.com') ||
                url.includes('facebook.com') ||
                url.includes('linkedin.com') ||
                url.includes('graph.') ||
                url.includes('/api/v') ||
                url.includes('graphql')
            ) {
                const clone = response.clone();
                clone.json().then(data => {
                    const foundVideos = findVideoUrls(data);
                    dispatchVideoUrls(foundVideos);
                }).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

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
                    reqUrl.includes('instagram.com') ||
                    reqUrl.includes('facebook.com') ||
                    reqUrl.includes('linkedin.com') ||
                    reqUrl.includes('/api/v') ||
                    reqUrl.includes('graphql')
                ) {
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

    function searchObjForVideoUrl(obj, seen = new Set(), depth = 0) {
        if (depth > 6 || !obj || typeof obj !== 'object') return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        if (Array.isArray(obj)) {
            for (let item of obj) {
                const res = searchObjForVideoUrl(item, seen, depth + 1);
                if (res) return res;
            }
        } else {
            for (let key of Object.keys(obj)) {
                if (key === 'return' || key === 'sibling' || key === '_owner' || key === 'parent') continue;

                const val = obj[key];
                if (typeof val === 'string') {
                    const isHttp = val.startsWith('https://') || val.startsWith('http://');
                    if (isHttp && !val.includes('blob:')) {
                        const lowerKey = key.toLowerCase();
                        const isVideoKey = VIDEO_KEYS.has(key) ||
                                           lowerKey.includes('video') ||
                                           lowerKey.includes('stream') ||
                                           lowerKey.includes('playback');
                        const lowerVal = val.toLowerCase();
                        const looksLikeVideo =
                            isVideoKey ||
                            lowerVal.includes('.mp4') ||
                            lowerVal.includes('.m4v') ||
                            lowerVal.includes('.webm') ||
                            (lowerVal.includes('licdn.com') && (lowerVal.includes('video') || lowerVal.includes('playlist'))) ||
                            (lowerVal.includes('fbcdn.net') && lowerVal.includes('video')) ||
                            (lowerVal.includes('cdninstagram.com') && lowerVal.includes('video'));

                        if (looksLikeVideo && !val.includes('bytestart')) {
                            return val;
                        }
                    }
                } else if (typeof val === 'object') {
                    const res = searchObjForVideoUrl(val, seen, depth + 1);
                    if (res) return res;
                }
            }
        }
        return null;
    }

    function extractVideoUrlFromReact(el) {
        let current = el;
        for (let i = 0; i < 10 && current; i++) {
            const key = Object.keys(current).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (key && current[key]) {
                const found = searchObjForVideoUrl(current[key]);
                if (found) return found;
            }
            current = current.parentElement;
        }
        return null;
    }

    window.addEventListener('magic_get_react_url', (e) => {
        if (!e.detail || !e.detail.id) return;
        const id = e.detail.id;
        const el = document.querySelector(`[data-magic-id="${id}"]`);

        let url = null;
        if (el) {
            url = extractVideoUrlFromReact(el);
        }

        window.dispatchEvent(new CustomEvent('magic_response_react_url_' + id, {
            detail: { url: url }
        }));
    });

})();
