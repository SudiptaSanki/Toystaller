// page_interceptor.js
// Runs in the main page context.
// Intercepts fetch/XHR network streams, tracks video IDs in Relay/GraphQL responses,
// monitors URL changes (Reels scrolling), and traverses React Fiber trees up through parent
// components to extract master HD video URLs (playable_url_quality_hd, browser_native_hd_url).

(function () {
    'use strict';
    if (window.__toystallerInterceptorLoaded) return;
    window.__toystallerInterceptorLoaded = true;

    // --- Video Store by Video ID & MRU History ---
    // Maps videoId -> { id, hd, sd, audioUrl, allUrls: Set, timestamp }
    const videoStoreById = new Map();
    const recentVideosMRU = []; // Ordered list of videoIds, most recent first (max 50)

    function recordVideoEntry(videoId, hdUrl, sdUrl, extraUrl, audioUrl = null) {
        if (!videoId && !hdUrl && !sdUrl && !extraUrl) return;
        const id = videoId ? String(videoId).trim() : null;

        let entry = id ? videoStoreById.get(id) : null;
        if (!entry) {
            entry = { id: id, hd: null, sd: null, audioUrl: null, allUrls: new Set(), timestamp: Date.now() };
            if (id) {
                videoStoreById.set(id, entry);
                const idx = recentVideosMRU.indexOf(id);
                if (idx !== -1) recentVideosMRU.splice(idx, 1);
                recentVideosMRU.unshift(id);
                if (recentVideosMRU.length > 50) {
                    const removed = recentVideosMRU.pop();
                    videoStoreById.delete(removed);
                }
            }
        }

        entry.timestamp = Date.now();
        if (hdUrl && isValidVideo(hdUrl)) entry.hd = hdUrl;
        if (sdUrl && isValidVideo(sdUrl)) entry.sd = sdUrl;
        if (audioUrl) entry.audioUrl = audioUrl;
        if (extraUrl && isValidVideo(extraUrl)) entry.allUrls.add(extraUrl);
        if (entry.hd) entry.allUrls.add(entry.hd);
        if (entry.sd) entry.allUrls.add(entry.sd);
    }

    // --- Monkey-patch history pushState / replaceState for Instant Reel Navigation Detection ---
    try {
        const originalPushState = history.pushState;
        history.pushState = function (...args) {
            const res = originalPushState.apply(this, args);
            window.postMessage({ type: 'toystaller_url_changed', url: window.location.href }, '*');
            return res;
        };
        const originalReplaceState = history.replaceState;
        history.replaceState = function (...args) {
            const res = originalReplaceState.apply(this, args);
            window.postMessage({ type: 'toystaller_url_changed', url: window.location.href }, '*');
            return res;
        };
        window.addEventListener('popstate', () => {
            window.postMessage({ type: 'toystaller_url_changed', url: window.location.href }, '*');
        });
    } catch (e) {}

    const getPlatform = () => {
        return (window.ToystallerPlatforms && window.ToystallerPlatforms['facebook']) || window.ToystallerPlatform || {
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

    // --- Parse JSON / Relay Chunks with Video ID Association ---
    function extractUrlsFromText(text) {
        if (!text || (!text.includes('fbcdn.net') && !text.includes('fbsbx.com') && !text.includes('playable_url') && !text.includes('browser_native_hd_url'))) return;

        let clean = text;
        if (clean.startsWith('for (;;);')) {
            clean = clean.substring(9);
        }

        const foundUrls = new Set();

        // 1. Regex search for video ID & HD / SD URLs in proximity
        const chunkRegex = /"(?:video_id|fbid|id)"\s*:\s*"?(\d{10,25})"?[\s\S]{1,1200}?"(playable_url_quality_hd|browser_native_hd_url|hd_src|playable_url|browser_native_sd_url|sd_src)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let cm;
        while ((cm = chunkRegex.exec(clean)) !== null) {
            const vid = cm[1];
            const key = cm[2];
            try {
                const rawUrl = JSON.parse('"' + cm[3] + '"');
                const u = cleanVideoUrl(rawUrl);
                if (u && isValidVideo(u)) {
                    foundUrls.add(u);
                    if (key.includes('hd')) {
                        recordVideoEntry(vid, u, null, u);
                    } else {
                        recordVideoEntry(vid, null, u, u);
                    }
                }
            } catch (err) {}
        }

        // 2. Direct named key scan: playable_url_quality_hd, browser_native_hd_url, etc.
        const videoRegex = /"(playable_url_quality_hd|browser_native_hd_url|hd_src|playable_url|browser_native_sd_url|sd_src|progressive_download_url)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let m;
        while ((m = videoRegex.exec(clean)) !== null) {
            const key = m[1];
            try {
                const rawUrl = JSON.parse('"' + m[2] + '"');
                const u = cleanVideoUrl(rawUrl);
                if (u && isValidVideo(u)) {
                    foundUrls.add(u);
                    if (key.includes('hd')) {
                        recordVideoEntry(null, u, null, u);
                    } else {
                        recordVideoEntry(null, null, u, u);
                    }
                }
            } catch (err) {}
        }

        // 3. Fallback scan for any CDN MP4 / M4V URL
        const cdnRegex = /"(https:(?:\\\/\\\/|\/\/)[^"]+?(?:fbcdn\.net|fbsbx\.com)[^"]+?\.(?:mp4|m4v)[^"]*)"/g;
        let cdnM;
        while ((cdnM = cdnRegex.exec(clean)) !== null) {
            try {
                const url = cleanVideoUrl(JSON.parse('"' + cdnM[1] + '"'));
                if (url && isValidVideo(url)) {
                    foundUrls.add(url);
                    recordVideoEntry(null, null, null, url);
                }
            } catch(e) {
                const unescaped = cleanVideoUrl(cdnM[1]);
                if (unescaped && isValidVideo(unescaped)) {
                    foundUrls.add(unescaped);
                    recordVideoEntry(null, null, null, unescaped);
                }
            }
        }

        // Dispatch found URLs to content script
        if (foundUrls.size > 0) {
            window.postMessage({
                type: 'toystaller_video_urls',
                urls: Array.from(foundUrls)
            }, '*');
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

    // --- Initial and Dynamic Script Scanning ---
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

    // Find currently active viewport video
    function findActiveViewportVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) return null;
        const playing = videos.filter(v => {
            if (v.paused || v.ended) return false;
            const r = v.getBoundingClientRect();
            return r.width > 120 && r.height > 120 &&
                   r.top < window.innerHeight && r.bottom > 0 &&
                   r.left < window.innerWidth && r.right > 0;
        });
        if (playing.length > 0) return playing[0];

        let best = null;
        let maxArea = 0;
        for (const v of videos) {
            const r = v.getBoundingClientRect();
            const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
            const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
            if (w > 0 && h > 0) {
                const area = w * h;
                if (area > maxArea) {
                    maxArea = area;
                    best = v;
                }
            }
        }
        return best;
    }

    // --- Deep React Fiber Traversal with Parent (return) Walk ---
    function inspectFiberProps(obj, seen = new Set(), depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 8) return { hd: null, sd: null, id: null, audioUrl: null };
        if (seen.has(obj)) return { hd: null, sd: null, id: null, audioUrl: null };
        seen.add(obj);

        let res = { hd: null, sd: null, id: null, audioUrl: null };

        // 1. Check for Video ID
        if (obj.id && typeof obj.id === 'string' && /^\d{10,25}$/.test(obj.id)) {
            res.id = obj.id;
        } else if (obj.video_id && typeof obj.video_id === 'string' && /^\d{10,25}$/.test(obj.video_id)) {
            res.id = obj.video_id;
        } else if (obj.videoId && typeof obj.videoId === 'string' && /^\d{10,25}$/.test(obj.videoId)) {
            res.id = obj.videoId;
        }

        // 2. Priority HD properties
        const hdCandidates = [
            obj.playable_url_quality_hd,
            obj.browser_native_hd_url,
            obj.hd_src,
            obj.hd_src_no_ratelimit,
            obj.progressive_download_url
        ];
        for (const c of hdCandidates) {
            if (typeof c === 'string') {
                const clean = cleanVideoUrl(c);
                if (clean && isValidVideo(clean)) {
                    res.hd = clean;
                    return res; // Found master HD!
                }
            }
        }

        // 3. Multi-version video array (video_versions)
        if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
            const sorted = [...obj.video_versions].sort((a, b) => {
                const resA = (a.width || 0) * (a.height || 0);
                const resB = (b.width || 0) * (b.height || 0);
                return resB - resA;
            });
            for (const v of sorted) {
                if (v && typeof v.url === 'string') {
                    const clean = cleanVideoUrl(v.url);
                    if (clean && isValidVideo(clean)) {
                        res.hd = clean;
                        return res;
                    }
                }
            }
        }

        // 4. Check for DASH representations (video + audio sync)
        if (Array.isArray(obj.representations) && obj.representations.length > 0) {
            let bestVideoRep = null;
            let bestAudioRep = null;
            let maxRes = 0;

            for (const rep of obj.representations) {
                if (!rep) continue;
                const repUrl = rep.base_url || rep.url;
                if (!repUrl || typeof repUrl !== 'string') continue;
                const mime = (rep.mime_type || '').toLowerCase();
                const codecs = (rep.codecs || '').toLowerCase();

                if (mime.includes('audio') || codecs.includes('mp4a')) {
                    if (!bestAudioRep) bestAudioRep = cleanVideoUrl(repUrl);
                } else {
                    const w = rep.width || 0;
                    const h = rep.height || 0;
                    const area = w * h;
                    if (area >= maxRes) {
                        maxRes = area;
                        bestVideoRep = cleanVideoUrl(repUrl);
                    }
                }
            }
            if (bestVideoRep && isValidVideo(bestVideoRep)) {
                res.hd = bestVideoRep;
                res.audioUrl = bestAudioRep;
                return res;
            }
        }

        // 5. SD properties
        const sdCandidates = [
            obj.playable_url,
            obj.browser_native_sd_url,
            obj.sd_src,
            obj.sd_src_no_ratelimit,
            obj.playback_url,
            obj.progressiveUrl,
            obj.streamingUrl,
            obj.video_url,
            obj.videoUrl
        ];
        for (const c of sdCandidates) {
            if (typeof c === 'string') {
                const clean = cleanVideoUrl(c);
                if (clean && isValidVideo(clean)) {
                    res.sd = clean;
                }
            }
        }

        // 6. Recurse into nested objects
        const priorityKeys = ['video', 'media', 'creation_story', 'playbackData', 'videoData', 'feedUnit', 'attachment', 'reel'];
        for (const k of priorityKeys) {
            if (obj[k] && typeof obj[k] === 'object') {
                const child = inspectFiberProps(obj[k], seen, depth + 1);
                if (child.hd) { res.hd = child.hd; res.audioUrl = child.audioUrl; return res; }
                if (child.sd && !res.sd) res.sd = child.sd;
                if (child.id && !res.id) res.id = child.id;
            }
        }

        for (const k of Object.keys(obj)) {
            if (priorityKeys.includes(k) || k === 'return' || k === 'sibling' || k === 'child' || k === '_owner' || k === 'stateNode') continue;
            if (obj[k] && typeof obj[k] === 'object') {
                const child = inspectFiberProps(obj[k], seen, depth + 1);
                if (child.hd) { res.hd = child.hd; res.audioUrl = child.audioUrl; return res; }
                if (child.sd && !res.sd) res.sd = child.sd;
                if (child.id && !res.id) res.id = child.id;
            }
        }

        return res;
    }

    // Traverses the React Fiber hierarchy from the given DOM element up to 45 ancestor components.
    function extractVideoUrlFromFiberTree(el) {
        if (!el) return null;

        // Locate Fiber key (specifically avoid __reactProps$ which only has DOM attributes)
        const fiberKey = Object.keys(el).find(k =>
            k.startsWith('__reactFiber$') ||
            k.startsWith('__reactInternalInstance$')
        );
        let fiber = fiberKey ? el[fiberKey] : null;

        let bestHd = null;
        let bestSd = null;
        let bestAudioUrl = null;
        let detectedId = null;

        let depth = 0;
        while (fiber && depth < 45) {
            if (fiber.memoizedProps) {
                const p = inspectFiberProps(fiber.memoizedProps);
                if (p.hd) { bestHd = p.hd; bestAudioUrl = p.audioUrl; break; }
                if (p.sd && !bestSd) bestSd = p.sd;
                if (p.id && !detectedId) detectedId = p.id;
            }
            if (fiber.memoizedState) {
                const s = inspectFiberProps(fiber.memoizedState);
                if (s.hd) { bestHd = s.hd; bestAudioUrl = s.audioUrl; break; }
                if (s.sd && !bestSd) bestSd = s.sd;
                if (s.id && !detectedId) detectedId = s.id;
            }
            if (fiber.pendingProps) {
                const pp = inspectFiberProps(fiber.pendingProps);
                if (pp.hd) { bestHd = pp.hd; bestAudioUrl = pp.audioUrl; break; }
                if (pp.sd && !bestSd) bestSd = pp.sd;
                if (pp.id && !detectedId) detectedId = pp.id;
            }

            fiber = fiber.return;
            depth++;
        }

        if (bestHd) {
            if (detectedId) recordVideoEntry(detectedId, bestHd, bestSd, bestHd, bestAudioUrl);
            return { url: bestHd, audioUrl: bestAudioUrl };
        }

        // If an ID was detected, check the video store for HD
        if (detectedId && videoStoreById.has(detectedId)) {
            const entry = videoStoreById.get(detectedId);
            if (entry.hd) return { url: entry.hd, audioUrl: entry.audioUrl || null };
        }

        if (bestSd) return { url: bestSd, audioUrl: null };
        return null;
    }

    // Extract Photo URL from React Fiber
    function extractImageUrlFromReact(el) {
        const platform = getPlatform();
        let current = el;
        for (let i = 0; i < 10 && current; i++) {
            const key = Object.keys(current).find(k =>
                k.startsWith('__reactProps$') ||
                k.startsWith('__reactFiber$') ||
                k.startsWith('__reactInternalInstance$')
            );
            if (key && current[key]) {
                const obj = current[key];
                if (platform.extractPriorityReactUrl) {
                    const photoUrl = platform.extractPriorityReactUrl(obj, false);
                    if (photoUrl) {
                        const clean = typeof photoUrl === 'object' ? photoUrl.url : photoUrl;
                        return clean;
                    }
                }
            }
            current = current.parentElement;
        }
        return null;
    }

    // --- Content Script Bridge via postMessage ---
    window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'magic_get_react_url' || !e.data.id) return;
        const reqId = e.data.id;
        const isVideo = e.data.isVideo !== undefined ? e.data.isVideo : true;
        const requestedVideoId = e.data.videoId ? String(e.data.videoId).trim() : null;
        let el = document.querySelector(`[data-magic-id="${reqId}"]`);

        let url = null;
        let audioUrl = null;

        if (isVideo) {
            // 1. If videoId was provided, check the video store first
            if (requestedVideoId && videoStoreById.has(requestedVideoId)) {
                const entry = videoStoreById.get(requestedVideoId);
                if (entry.hd) {
                    url = entry.hd;
                    audioUrl = entry.audioUrl || null;
                } else if (entry.sd) {
                    url = entry.sd;
                }
            }

            // 2. Walk the React Fiber component hierarchy of el
            if (!url && el) {
                const fiberRes = extractVideoUrlFromFiberTree(el);
                if (fiberRes) {
                    url = fiberRes.url;
                    audioUrl = fiberRes.audioUrl || null;
                }
            }

            // 3. If el didn't find video, check if there's a child video
            if (!url && el && el.querySelector) {
                const childVid = el.querySelector('video');
                if (childVid) {
                    const fiberRes = extractVideoUrlFromFiberTree(childVid);
                    if (fiberRes) {
                        url = fiberRes.url;
                        audioUrl = fiberRes.audioUrl || null;
                    }
                }
            }

            // 4. On dedicated single-video views (like /reel/ or /watch/), allow active viewport fallback
            if (!url && (window.location.pathname.includes('/reel/') || window.location.pathname.includes('/watch/'))) {
                const activeVid = findActiveViewportVideo();
                if (activeVid) {
                    const fiberRes = extractVideoUrlFromFiberTree(activeVid);
                    if (fiberRes) {
                        url = fiberRes.url;
                        audioUrl = fiberRes.audioUrl || null;
                    }
                }
            }

            // 4. Check current Reel ID from URL if on /reel/
            if (!url && window.location.pathname.includes('/reel/')) {
                const m = window.location.pathname.match(/\/reel\/(\d+)/);
                if (m && m[1] && videoStoreById.has(m[1])) {
                    const entry = videoStoreById.get(m[1]);
                    if (entry.hd) {
                        url = entry.hd;
                        audioUrl = entry.audioUrl || null;
                    } else if (entry.sd) {
                        url = entry.sd;
                    }
                }
            }

            // 5. Platform DOM / Script lookup matched to Video ID
            if (!url && el) {
                const platform = getPlatform();
                if (platform.extractVideoUrlFromDOM) {
                    const domRes = platform.extractVideoUrlFromDOM(el);
                    if (domRes) {
                        if (typeof domRes === 'object') {
                            url = domRes.url;
                            audioUrl = domRes.audioUrl || null;
                        } else if (typeof domRes === 'string') {
                            url = domRes;
                        }
                    }
                }
            }
        } else {
            if (el) {
                url = extractImageUrlFromReact(el);
            }
        }

        // Guarantee non-video internal URLs are never sent back for video requests
        if (isVideo && url && !isValidVideo(url)) {
            url = null;
            audioUrl = null;
        }

        window.postMessage({
            type: 'magic_response_react_url_' + reqId,
            url: url,
            audioUrl: audioUrl
        }, '*');
    });

})();
