// platforms/linkedin.js
// LinkedIn platform configuration — sets window.ToystallerActivePlatform (content world)
// and window.ToystallerPlatform (MAIN world for interceptor).

(function() {
    const linkedinPlatform = {
        name: 'LinkedIn',
        version: 'v1.0',
        specialization: 'Specialized HD media extractor for LinkedIn — Feed, Profiles, Articles, Modals, and Messaging with Anti-Redirect HTML5 Player.',

        // --- Content Script Interface ---

        getPlatformConfig(path, media) {
            return { preferredCorners: ['top-left', 'top-right', 'bottom-right'], padding: 12, topOffset: 4 };
        },

        getContext(path) {
            const p = (path || window.location.pathname || '').toLowerCase();
            if (p.includes('/feed/')) return 'li-feed';
            if (p.includes('/pulse/') || p.includes('/article/')) return 'li-articles';
            if (p.includes('/messaging/')) return 'li-messaging';
            if (p.includes('/in/')) return 'li-profile';
            return 'linkedin';
        },

        hasActiveModal() {
            // LinkedIn uses .artdeco-modal for actual modals
            const modals = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
            for (const modal of modals) {
                const rect = modal.getBoundingClientRect();
                if (rect.width > 400 && rect.height > 400) return true;
            }
            return false;
        },

        isInsideModal(media) {
            const modals = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
            for (const modal of modals) {
                const rect = modal.getBoundingClientRect();
                if (rect.width > 400 && rect.height > 400 && modal.contains(media)) return true;
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
            // LinkedIn profile pics and small icons
            const style = window.getComputedStyle(media);
            if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius, 10) > 40)) return true;
            return false;
        },

        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        },

        // Open video in new tab routed to dedicated Anti-Redirect HTML5 Player
        useDirectDownload: false,

        // LinkedIn doesn't reliably use React Fiber for thumbnails
        useReactThumbnail: false,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com');
        },

        // LinkedIn image URL upgrading — force highest resolution
        upgradeImageUrl(url) {
            if (url && url.includes('media.licdn.com/dms/image')) {
                return url.replace(/\/(100|200|400|800)\//g, '/1000/');
            }
            return url;
        },

        // LinkedIn video thumbnail extraction
        extractThumbnail(media, interceptedUrls, safeSendMessage, callback) {
            // Check intercepted URLs for video covers
            if (interceptedUrls.size > 0) {
                const covers = Array.from(interceptedUrls).filter(u => u.includes('videocover'));
                if (covers.length > 0) {
                    callback(covers[0]);
                    return;
                }
            }

            // Ask background script for network-intercepted images
            safeSendMessage({ action: 'getMediaUrls', mediaType: 'img' }, (response) => {
                if (response && response.urls && response.urls.length > 0) {
                    const covers = response.urls.filter(u => u.includes('videocover'));
                    if (covers.length > 0) {
                        callback(covers[0]);
                        return;
                    }
                }
                callback(null);
            });
        },

        filterBackgroundUrls(candidates, isVideo) {
            return candidates.filter(u => {
                const lower = u.toLowerCase();
                if (isVideo && (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp'))) {
                    return false;
                }
                if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash') || lower.includes('bytestart') || lower.includes('/audio') || lower.includes('manifest')) {
                    return false;
                }
                return (lower.includes('licdn.com') && (lower.includes('playlist/vid') || lower.includes('video') || lower.includes('playback') || lower.includes('progressive'))) || lower.includes('.mp4');
            });
        },

        // --- Interceptor Interface (MAIN world) ---

        getInterceptUrls() {
            return ['linkedin.com', '/api/v', 'voyager/api', 'dms.licdn.com'];
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            const lowerVal = val.toLowerCase();
            return lowerVal.includes('//www.linkedin.com') || lowerVal.includes('//linkedin.com');
        },

        looksLikeReactImage(val, key) {
            const lowerVal = val.toLowerCase();
            const lowerKey = (key || '').toLowerCase();
            return (
                lowerKey.includes('image') ||
                lowerKey.includes('thumbnail') ||
                lowerKey.includes('cover') ||
                lowerVal.includes('.jpg') ||
                lowerVal.includes('.png') ||
                lowerVal.includes('.webp') ||
                lowerVal.includes('.heic') ||
                lowerVal.includes('/image/')
            );
        },

        looksLikeReactVideo(val, key) {
            if (!val || typeof val !== 'string' || !val.startsWith('http')) return false;
            const lowerVal = val.toLowerCase();
            const lowerKey = (key || '').toLowerCase();

            // Explicitly reject images and video covers
            if (lowerVal.includes('/image/') || lowerVal.includes('videocover') || lowerVal.includes('.jpg') || lowerVal.includes('.png') || lowerVal.includes('.webp') || lowerVal.includes('.heic')) {
                return false;
            }

            // Reject DASH manifests, HLS playlists, segments, and audio tracks that cause 0:00 video playback
            if (lowerVal.includes('.mpd') || lowerVal.includes('.m3u8') || lowerVal.includes('stream_type=dash') || lowerVal.includes('/manifest') || lowerVal.includes('bytestart') || lowerVal.includes('/audio') || lowerKey.includes('audio')) {
                return false;
            }

            // Must be an MP4 or progressive video stream from licdn
            if (lowerVal.includes('.mp4') || lowerVal.includes('.m4v')) {
                return true;
            }

            return lowerVal.includes('licdn.com') && (lowerVal.includes('playlist/vid') || lowerVal.includes('video') || lowerVal.includes('playback') || lowerVal.includes('progressive'));
        },

        extractPriorityReactUrl(val, isVideoContext) {
            if (!val || typeof val !== 'object') return null;

            // 1. LinkedIn Voyager VideoPlayMetadata: progressiveStreams array
            if (Array.isArray(val.progressiveStreams) && val.progressiveStreams.length > 0) {
                let bestStream = null;
                let bestScore = -1;
                for (const stream of val.progressiveStreams) {
                    if (!stream) continue;
                    const streamUrl = stream.streamingLocation || stream.url || stream.src;
                    if (!streamUrl || typeof streamUrl !== 'string' || !streamUrl.startsWith('http')) continue;
                    if (streamUrl.includes('manifest') || streamUrl.includes('.mpd') || streamUrl.includes('.m3u8')) continue;

                    const bitrate = parseInt(stream.bitRate || stream.bitrate || '0', 10);
                    const height = parseInt(stream.height || '0', 10);
                    const size = parseInt(stream.size || '0', 10);
                    const score = bitrate > 0 ? bitrate : (height * 1000 + size);
                    if (score > bestScore) {
                        bestScore = score;
                        bestStream = streamUrl;
                    }
                }
                if (bestStream) return bestStream.split('#')[0];
            }

            // 2. Direct progressive stream object with streamingLocation
            if (typeof val.streamingLocation === 'string' && val.streamingLocation.startsWith('http')) {
                if (!val.streamingLocation.includes('manifest') && !val.streamingLocation.includes('.mpd') && !val.streamingLocation.includes('.m3u8')) {
                    return val.streamingLocation.split('#')[0];
                }
            }

            // 3. streamingUrl or progressiveUrl
            if (typeof val.streamingUrl === 'string' && val.streamingUrl.startsWith('http')) {
                if (!val.streamingUrl.includes('manifest') && !val.streamingUrl.includes('.mpd') && !val.streamingUrl.includes('.m3u8')) {
                    return val.streamingUrl.split('#')[0];
                }
            }
            if (typeof val.progressiveUrl === 'string' && val.progressiveUrl.startsWith('http')) {
                if (!val.progressiveUrl.includes('manifest') && !val.progressiveUrl.includes('.mpd') && !val.progressiveUrl.includes('.m3u8')) {
                    return val.progressiveUrl.split('#')[0];
                }
            }

            return null;
        },

        isValidVideo(url) {
            if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
            const lower = url.toLowerCase();
            if (lower.includes('.mpd') || lower.includes('.m3u8') || lower.includes('manifest')) return false;
            if (lower.includes('/audio') || lower.includes('bytestart')) return false;
            return !(lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com'));
        },

        extractVideoUrlFromDOM(el) {
            if (!el) return null;

            // Check el itself, video child if el is a wrapper, or nearest container with data-sources
            const targetEl = (el.tagName === 'VIDEO' ? el : (el.querySelector ? el.querySelector('video') : el)) || el;
            let sourcesData = targetEl.getAttribute('data-sources') ||
                                (targetEl.closest && targetEl.closest('[data-sources]') && targetEl.closest('[data-sources]').getAttribute('data-sources')) ||
                                (targetEl.parentElement && targetEl.parentElement.getAttribute('data-sources')) ||
                                (el.closest && el.closest('[data-sources]') && el.closest('[data-sources]').getAttribute('data-sources'));

            if (!sourcesData && el.querySelector) {
                const childWithSources = el.querySelector('[data-sources]');
                if (childWithSources) sourcesData = childWithSources.getAttribute('data-sources');
            }

            if (sourcesData) {
                try {
                    const sources = typeof sourcesData === 'string' ? JSON.parse(sourcesData) : sourcesData;
                    if (Array.isArray(sources)) {
                        let bestMp4 = null;
                        let bestMp4Bitrate = -1;
                        let bestHls = null;
                        let bestHlsBitrate = -1;

                        for (const src of sources) {
                            if (!src) continue;
                            const srcUrl = src.src || src.url || src.streamingLocation;
                            if (srcUrl && typeof srcUrl === 'string' && this.isValidVideo(srcUrl)) {
                                if (srcUrl.includes('manifest') || srcUrl.includes('.mpd') || srcUrl.includes('/audio')) continue;
                                if (src.type && src.type.includes('dash')) continue;

                                const isMp4 = (src.type && src.type.includes('mp4')) || srcUrl.includes('.mp4');
                                const bitrate = parseInt(src['data-bitrate'] || src.bitRate || src.bitrate || '0', 10);

                                if (isMp4) {
                                    if (bitrate > bestMp4Bitrate || !bestMp4) {
                                        bestMp4Bitrate = bitrate;
                                        bestMp4 = srcUrl;
                                    }
                                } else {
                                    if (bitrate > bestHlsBitrate || !bestHls) {
                                        bestHlsBitrate = bitrate;
                                        bestHls = srcUrl;
                                    }
                                }
                            }
                        }
                        const chosen = bestMp4 || bestHls;
                        if (chosen) return chosen.split('#')[0];
                    }
                } catch (e) {}
            }

            // Fallback: Check if targetEl has direct non-blob src or source children
            const currentSrc = targetEl.currentSrc || targetEl.src;
            if (currentSrc && typeof currentSrc === 'string' && !currentSrc.startsWith('blob:') && !currentSrc.startsWith('data:') && this.isValidVideo(currentSrc)) {
                return currentSrc.split('#')[0];
            }

            const sourceTags = targetEl.querySelectorAll ? targetEl.querySelectorAll('source') : [];
            for (const s of sourceTags) {
                if (s.src && !s.src.startsWith('blob:') && !s.src.startsWith('data:') && this.isValidVideo(s.src)) {
                    return s.src.split('#')[0];
                }
            }

            return null;
        }
    };

    if (typeof window !== 'undefined') {
        window.ToystallerPlatform = linkedinPlatform;
        window.ToystallerActivePlatform = linkedinPlatform;
    }
})();
