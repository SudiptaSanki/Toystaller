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
        if (val && typeof val.streamingUrl === 'string') {
            let suffix = '#video.mp4';
            if (val.height) suffix = `#_q=${val.height}p_video.mp4`;
            return val.streamingUrl + suffix;
        }
        if (val && typeof val.progressiveUrl === 'string') {
            let suffix = '#video.mp4';
            if (val.height) suffix = `#_q=${val.height}p_video.mp4`;
            return val.progressiveUrl + suffix;
        }
        return null;
    },

    // Background Script filtering (content_script.js fallback)
    filterBackgroundUrls(candidates, isVideo) {
        return candidates;
    }
};
