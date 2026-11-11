window.ToystallerPlatforms = window.ToystallerPlatforms || {};

window.ToystallerPlatforms['generic'] = {
    name: 'generic',
    
    // Layout & Positioning
    getPlatformConfig(path) {
        return { preferredCorners: ['bottom-right', 'bottom-left', 'top-left'], padding: 10 };
    },

    // Context & State
    getContext(path) {
        return 'generic';
    },
    
    hasActiveModal() {
        return false;
    },
    
    isInsideModal(media) {
        return false;
    },
    
    // Filtering
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
    
    // UI Scaling
    getButtonScale(media) {
        const rect = media.getBoundingClientRect();
        const minSide = Math.min(rect.width, rect.height);
        if (minSide < 180) return 0.85;
        if (minSide < 280) return 0.95;
        return 1;
    },

    // React Fiber Extraction logic (page_interceptor.js)
    getReactVideoKeys() {
        return ['video_url', 'playback_url', 'src', 'url', 'progressiveUrl', 'downloadUrl', 'streamingUrl', 'videoUrl', 'progressiveStreams', 'transcodedVideoUrl'];
    },
    
    shouldSkipReactValue(val, key, isVideoContext) {
        return false;
    },
    
    looksLikeReactImage(val, key) {
        const lowerVal = val.toLowerCase();
        const lowerKey = key.toLowerCase();
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
        const lowerVal = val.toLowerCase();
        return lowerVal.includes('.mp4') || lowerVal.includes('.m4v') || lowerVal.includes('.webm');
    },
    
    extractPriorityReactUrl(val, isVideoContext) {
        if (!val || typeof val !== 'object') return null;

        // Check variant list (sources, representations, video_versions)
        const variants = val.sources || val.video_versions || val.representations || val.qualities;
        if (Array.isArray(variants) && variants.length > 0) {
            let best = null;
            let bestScore = -1;
            for (const item of variants) {
                if (!item) continue;
                const itemUrl = item.url || item.src || item.streamingLocation;
                if (!itemUrl || typeof itemUrl !== 'string') continue;
                const lower = itemUrl.toLowerCase();
                if (lower.includes('/audio') || lower.includes('.mpd')) continue;

                const w = parseInt(item.width || item['data-width'] || 0, 10);
                const h = parseInt(item.height || item['data-height'] || 0, 10);
                const br = parseInt(item.bitrate || item.bitRate || item['data-bitrate'] || 0, 10);
                const score = (w * h) || br || (lower.includes('1080') ? 1080 : lower.includes('720') ? 720 : 0);
                if (score > bestScore || !best) {
                    bestScore = score;
                    best = itemUrl;
                }
            }
            if (best) return best.split('#')[0];
        }

        if (typeof val.streamingUrl === 'string') {
            return val.streamingUrl.split('#')[0];
        }
        if (typeof val.progressiveUrl === 'string') {
            return val.progressiveUrl.split('#')[0];
        }
        if (typeof val.videoUrl === 'string') {
            return val.videoUrl.split('#')[0];
        }
        if (typeof val.downloadUrl === 'string') {
            return val.downloadUrl.split('#')[0];
        }
        return null;
    },

    // Background Script filtering (content_script.js fallback)
    filterBackgroundUrls(candidates, isVideo) {
        if (!candidates || !Array.isArray(candidates)) return [];
        return candidates.filter(u => {
            if (!u || typeof u !== 'string') return false;
            const lower = u.toLowerCase();
            if (isVideo) {
                if (lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('/audio') || lower.includes('mime=audio')) return false;
                return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.m4v') || lower.includes('.m3u8') || lower.includes('/video/');
            }
            return lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('.svg');
        });
    }
};
