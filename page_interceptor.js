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
        'adaptiveStreams', 'mediaUrl',
        'media', 'rootUrl', 'liveVideoUrl', 'thumbnail'
    ]);

    const getPlatform = () => {
        if (window.ToystallerPlatform) return window.ToystallerPlatform;
        if (window.ToystallerActivePlatform) return window.ToystallerActivePlatform;
        const host = window.location.hostname.toLowerCase();
        const platforms = window.ToystallerPlatforms || {};
        if (host.includes('facebook.com') && platforms['facebook']) return platforms['facebook'];
        if (host.includes('instagram.com') && platforms['instagram']) return platforms['instagram'];
        if (host.includes('linkedin.com') && platforms['linkedin']) return platforms['linkedin'];
        if (host.includes('whatsapp.com') && platforms['whatsapp']) return platforms['whatsapp'];
        return platforms['generic'] || {};
    };

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

    function isValidVideo(url) {
        return getPlatform().isValidVideo ? getPlatform().isValidVideo(url) : true;
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
                const audioFound = platform.extractPriorityAudioUrl && platform.extractPriorityAudioUrl(val);
                if (audioFound) {
                    found.add(audioFound);
                }
                const dashFound = platform.extractDashVideoFromReact && platform.extractDashVideoFromReact(val);
                if (dashFound) {
                    found.add(dashFound);
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

    // Safe fetch() wrapper:
    // Always invokes with window context to prevent "Illegal invocation" in strict mode.
    // Strictly targets JSON API / GraphQL responses and never clones or locks media/binary streams.
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const promise = originalFetch.apply(window, args);
        try {
            const rawUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const lowerUrl = rawUrl.toLowerCase();
            // Strictly exclude video streams, byte ranges, manifests, and CDNs
            if (
                !lowerUrl.includes('.mp4') &&
                !lowerUrl.includes('.m4v') &&
                !lowerUrl.includes('.webm') &&
                !lowerUrl.includes('bytestart') &&
                !lowerUrl.includes('cdninstagram.com') &&
                !lowerUrl.includes('fbcdn.net') &&
                (
                    lowerUrl.includes('/api/v') ||
                    lowerUrl.includes('graphql') ||
                    lowerUrl.includes('voyager/api')
                )
            ) {
                promise.then(response => {
                    try {
                        const contentType = response.headers ? response.headers.get('content-type') : '';
                        if (contentType && contentType.includes('application/json')) {
                            response.clone().json().then(data => {
                                const foundVideos = findVideoUrls(data);
                                dispatchVideoUrls(foundVideos);
                            }).catch(() => {});
                        }
                    } catch (e) {}
                }).catch(() => {});
            }
        } catch (e) {}
        return promise;
    };

    // Safe prototype hooking for XMLHttpRequest:
    // Retains native window.XMLHttpRequest constructor, preserves XMLHttpRequest.DONE and readyState constants,
    // and never accesses responseText on arraybuffer/blob media streams (preventing InvalidStateError).
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._toystaller_url = (typeof url === 'string') ? url : '';
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                // Strict guard: only inspect if response is text/json.
                // Modern video loaders use arraybuffer/blob — accessing responseText on those throws InvalidStateError!
                if (this.responseType !== '' && this.responseType !== 'text') {
                    return;
                }
                const reqUrl = (this._toystaller_url || '').toLowerCase();
                // Never intercept binary media, dash manifests, or CDN video chunks
                if (reqUrl.includes('.mp4') || reqUrl.includes('.m4v') || reqUrl.includes('bytestart') || reqUrl.includes('cdninstagram.com')) {
                    return;
                }
                if (
                    reqUrl.includes('/api/v') ||
                    reqUrl.includes('graphql') ||
                    reqUrl.includes('voyager/api')
                ) {
                    const text = this.responseText;
                    if (text && (text.startsWith('{') || text.startsWith('['))) {
                        const data = JSON.parse(text);
                        const foundVideos = findVideoUrls(data);
                        dispatchVideoUrls(foundVideos);
                    }
                }
            } catch (e) {}
        });
        return originalXHRSend.apply(this, args);
    };

    const SKIP_KEYS = new Set([
        'return', 'sibling', 'child', 'alternate', 'stateNode',
        '_owner', 'parent', 'parentElement', 'document', 'window'
    ]);

    function isSafeObject(obj) {
        if (!obj || typeof obj !== 'object') return false;
        if (typeof Node !== 'undefined' && obj instanceof Node) return false;
        if (obj.nodeType || obj === window || obj === document) return false;
        return true;
    }

    function searchObjForVideoUrl(obj, seen = new Set(), depth = 0, isVideoContext = true) {
        if (depth > 8 || !isSafeObject(obj)) return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        const platform = getPlatform();

        // Check if the current object directly has priority master video candidates (with audio)
        if (platform.extractPriorityReactUrl) {
            const priority = platform.extractPriorityReactUrl(obj, isVideoContext);
            if (priority) return priority;
        }

        if (Array.isArray(obj)) {
            for (let item of obj) {
                const res = searchObjForVideoUrl(item, seen, depth + 1, isVideoContext);
                if (res) return res;
            }
        } else {
            for (let key of Object.keys(obj)) {
                if (SKIP_KEYS.has(key)) continue;

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
                } else if (typeof val === 'object' && val !== null) {
                    const nested = searchObjForVideoUrl(val, seen, depth + 1, isVideoContext);
                    if (nested) return nested;
                }
            }
        }
        return null;
    }

    function searchObjForAudioUrl(obj, seen = new Set(), depth = 0) {
        if (depth > 8 || !isSafeObject(obj)) return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        const platform = getPlatform();

        if (Array.isArray(obj)) {
            for (let item of obj) {
                const res = searchObjForAudioUrl(item, seen, depth + 1);
                if (res) return res;
            }
        } else {
            if (platform.extractPriorityAudioUrl) {
                const found = platform.extractPriorityAudioUrl(obj);
                if (found) return found;
            }
            for (let key of Object.keys(obj)) {
                if (SKIP_KEYS.has(key)) continue;
                const val = obj[key];
                if (typeof val === 'string') {
                    if (platform.isValidAudio && platform.isValidAudio(val)) {
                        return val;
                    }
                } else if (typeof val === 'object' && val !== null) {
                    const nested = searchObjForAudioUrl(val, seen, depth + 1);
                    if (nested) return nested;
                }
            }
        }
        return null;
    }

    function searchObjForDashVideoUrl(obj, seen = new Set(), depth = 0) {
        if (depth > 8 || !isSafeObject(obj)) return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        const platform = getPlatform();

        if (Array.isArray(obj)) {
            for (let item of obj) {
                const res = searchObjForDashVideoUrl(item, seen, depth + 1);
                if (res) return res;
            }
        } else {
            if (platform.extractDashVideoFromReact) {
                const found = platform.extractDashVideoFromReact(obj);
                if (found) return found;
            }
            for (let key of Object.keys(obj)) {
                if (SKIP_KEYS.has(key)) continue;
                const val = obj[key];
                if (typeof val === 'string') {
                    if (platform.isValidDashVideo && platform.isValidDashVideo(val)) {
                        return val;
                    }
                } else if (typeof val === 'object' && val !== null) {
                    const nested = searchObjForDashVideoUrl(val, seen, depth + 1);
                    if (nested) return nested;
                }
            }
        }
        return null;
    }

    function extractMediaBundle(el, isVideoContext = true) {
        if (!el) return { url: null, audioUrl: null, mutedUrl: null };
        try {
            const platform = getPlatform();

            let progressiveUrl = null;
            let dashVideoUrl = null;
            let audioUrl = null;

            // Pass 1: Direct Fiber Tree Walk starting at el (HostComponent <video>)
            // Walk fiber.return up through React functional and class component ancestors
            const fiberKey = Object.keys(el).find(k => 
                k.startsWith('__reactFiber$') || 
                k.startsWith('__reactInternalInstance$')
            );
            
            let fiber = fiberKey ? el[fiberKey] : null;
            let fiberDepth = 0;
            while (fiber && fiberDepth < 35) {
                if (fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
                    if (!progressiveUrl) {
                        const found = searchObjForVideoUrl(fiber.memoizedProps, new Set(), 0, isVideoContext);
                        if (found && !found.toLowerCase().includes('stream_type=dash')) {
                            progressiveUrl = found;
                        }
                    }
                    if (!dashVideoUrl && platform.extractDashVideoFromReact) {
                        const foundDash = platform.extractDashVideoFromReact(fiber.memoizedProps);
                        if (foundDash) dashVideoUrl = foundDash;
                    }
                    if (!audioUrl) {
                        const audioExtractor = platform.extractAudioUrlFromReact || platform.extractPriorityAudioUrl;
                        if (audioExtractor) {
                            const foundAudio = audioExtractor.call(platform, fiber.memoizedProps);
                            if (foundAudio) audioUrl = foundAudio;
                        }
                    }
                }

                if (fiber.memoizedState && typeof fiber.memoizedState === 'object') {
                    if (!progressiveUrl) {
                        const found = searchObjForVideoUrl(fiber.memoizedState, new Set(), 0, isVideoContext);
                        if (found && !found.toLowerCase().includes('stream_type=dash')) {
                            progressiveUrl = found;
                        }
                    }
                    if (!dashVideoUrl && platform.extractDashVideoFromReact) {
                        const foundDash = platform.extractDashVideoFromReact(fiber.memoizedState);
                        if (foundDash) dashVideoUrl = foundDash;
                    }
                    if (!audioUrl) {
                        const audioExtractor = platform.extractAudioUrlFromReact || platform.extractPriorityAudioUrl;
                        if (audioExtractor) {
                            const foundAudio = audioExtractor.call(platform, fiber.memoizedState);
                            if (foundAudio) audioUrl = foundAudio;
                        }
                    }
                }

                if (progressiveUrl && audioUrl) break;
                fiber = fiber.return;
                fiberDepth++;
            }

            // Pass 2: Check __reactProps$ on DOM parents, strictly stopping at post/feed-unit boundary
            if (!progressiveUrl) {
                let current = el;
                for (let i = 0; i < 14 && current; i++) {
                    const propsKey = Object.keys(current).find(k => k.startsWith('__reactProps$'));
                    if (propsKey && current[propsKey]) {
                        const found = searchObjForVideoUrl(current[propsKey], new Set(), 0, isVideoContext);
                        if (found && !found.toLowerCase().includes('stream_type=dash')) {
                            progressiveUrl = found;
                            break;
                        }
                        if (!audioUrl) {
                            const audioExtractor = platform.extractAudioUrlFromReact || platform.extractPriorityAudioUrl;
                            if (audioExtractor) {
                                const foundAudio = audioExtractor.call(platform, current[propsKey]);
                                if (foundAudio) audioUrl = foundAudio;
                            }
                        }
                    }
                    // Stop at post container boundary to NEVER bleed into adjacent posts on the feed
                    if (current.getAttribute && (current.getAttribute('role') === 'article' || (current.dataset && current.dataset.pagelet && current.dataset.pagelet.startsWith('FeedUnit')))) {
                        break;
                    }
                    current = current.parentElement;
                }
            }

            // Pass 3: Check DOM scripts for progressive videos matching videoId (no global bleeding)
            if (!progressiveUrl && platform.extractVideoUrlFromDOM) {
                const domUrl = platform.extractVideoUrlFromDOM(el);
                if (domUrl && !domUrl.toLowerCase().includes('stream_type=dash')) {
                    progressiveUrl = domUrl;
                }
            }

            // Pass 4: Audio URL from DOM scripts matching videoId
            if (!audioUrl && platform.extractAudioUrlFromDOM) {
                audioUrl = platform.extractAudioUrlFromDOM(el);
            }

            // Pass 5: DASH / Muted Video URL from DOM scripts matching videoId
            if (!dashVideoUrl && platform.extractDashVideoFromDOM) {
                dashVideoUrl = platform.extractDashVideoFromDOM(el);
            }

            const finalUrl = progressiveUrl || dashVideoUrl;
            const finalMuted = dashVideoUrl || null;

            return {
                url: finalUrl ? cleanVideoUrl(finalUrl) : null,
                audioUrl: audioUrl ? cleanVideoUrl(audioUrl) : null,
                mutedUrl: finalMuted ? cleanVideoUrl(finalMuted) : null
            };
        } catch (err) {
            console.warn('Toystaller: extractMediaBundle error:', err);
            return { url: null, audioUrl: null, mutedUrl: null };
        }
    }

    function extractVideoUrlFromReact(el, isVideoContext = true) {
        const bundle = extractMediaBundle(el, isVideoContext);
        return bundle.url;
    }

    function extractAudioUrlFromReact(el) {
        const bundle = extractMediaBundle(el, true);
        return bundle.audioUrl;
    }

    // Facebook-specific: Parse relay data from <script> tags to find progressive video URLs

    window.addEventListener('message', (e) => {
        try {
            if (!e.data || e.data.type !== 'magic_get_react_url' || !e.data.id) return;
            const id = e.data.id;
            const isVideo = e.data.isVideo !== undefined ? e.data.isVideo : true;
            const el = document.querySelector(`[data-magic-id="${id}"]`);

            let result = { url: null, audioUrl: null, mutedUrl: null };
            if (el) {
                if (isVideo) {
                    result = extractMediaBundle(el, true);
                } else {
                    result.url = extractVideoUrlFromReact(el, false);
                }
            }

            window.postMessage({
                type: 'magic_response_react_url_' + id,
                url: result.url,
                audioUrl: result.audioUrl,
                mutedUrl: result.mutedUrl
            }, '*');
        } catch (err) {
            console.warn('Toystaller: window message handler error:', err);
            if (e && e.data && e.data.id) {
                window.postMessage({
                    type: 'magic_response_react_url_' + e.data.id,
                    url: null,
                    audioUrl: null,
                    mutedUrl: null
                }, '*');
            }
        }
    });

})();
