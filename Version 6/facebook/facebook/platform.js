window.ToystallerPlatforms = window.ToystallerPlatforms || {};

(function() {
    // ============================================================
    // Facebook Section Route Map (v6.0)
    // ============================================================
    //
    // URL Pattern                                    → Section
    // ──────────────────────────────────────────────────────────────
    // [Any URL when dialog / media viewer open]      → modal (Theater mode)
    // /friends or /friends/* or sk=friends           → friends
    // / or /?sk=*                                    → feed
    // /watch/ or /videos/                            → watch
    // /reel/ or /reels/                              → reels
    // /stories/                                      → stories
    // /groups/                                       → groups
    // /messages/ or messenger.com                    → messages
    // /marketplace/                                  → marketplace
    // /photo/ or /photos/ or /media/set/             → photos
    // /<user>/photos or sk=photos                    → profile_photos
    // /<user>/videos or sk=videos                    → profile_videos
    // /<user>/reels_tab                              → profile_reels
    // /<user> or /profile.php                        → profile_timeline
    // /settings, /privacy, /help, /policies          → settings (ignored)
    // ============================================================

    const facebookPlatform = {
        name: 'facebook',
        version: 'v6.0',
        specialization: 'Per-page Facebook media extraction — Theater Mode, Watch Player, Reels, Stories, News Feed Posts, Groups, Photo Albums, and Profile Timeline.',

        // --- Video URL Validator ---
        isValidVideo(url) {
            if (!url || typeof url !== 'string') return false;
            const lower = url.toLowerCase();
            if (lower.startsWith('blob:') || lower.startsWith('data:')) return false;
            if (lower.includes('facebook.com') || lower.includes('messenger.com') || lower.includes('instagram.com')) return false;
            if (lower.includes('unified_cvc')) return false;
            if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash')) return false;
            
            // Reject image extensions & covers
            if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('videocover') || lower.includes('/t15.')) {
                return false;
            }

            const isCdn = lower.includes('fbcdn.net') || lower.includes('fbsbx.com');
            const isVideoExt = lower.includes('.mp4') || lower.includes('.m4v') || lower.includes('.webm');
            const isVideoPath = lower.includes('/v/t42.') || lower.includes('/v/t64.') || lower.includes('/video/') || lower.includes('mime=video');

            return isCdn && (isVideoExt || isVideoPath);
        },

        cleanVideoUrl(url) {
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
        },

        // --- Route & Section Detection ---
        getSection() {
            const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
            const search = window.location.search.toLowerCase();
            const host = window.location.hostname.toLowerCase();

            // 1. Settings / static pages — skip
            if (path.startsWith('/settings') || path.startsWith('/privacy') ||
                path.startsWith('/help') || path.startsWith('/policies') ||
                path.startsWith('/checkpoint') || path.startsWith('/login')) {
                return 'settings';
            }

            // 2. Dedicated video & media player routes MUST precede generic modal detection:
            // (On Facebook, Reels are wrapped in a dialog/modal container, so checking modal first misclassifies Reels)
            if (path.startsWith('/reel/') || path.startsWith('/reels') || search.includes('reel_id=')) return 'reels';
            if (path.startsWith('/watch') || path.startsWith('/videos/')) return 'watch';
            if (path.startsWith('/stories')) return 'stories';

            // 3. Friends section (including profile visits from friend suggestions: /friends/suggestions/?profile_id=...)
            if (path === '/friends' || path.startsWith('/friends') || search.includes('sk=friends')) {
                return 'friends';
            }

            // 4. Check if active modal is specifically a Reel player dialog
            const activeModal = this.getActiveModal();
            if (activeModal && activeModal.querySelector('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reel"], [aria-label*="Reel" i]')) {
                return 'reels';
            }

            // 5. Theater / MediaViewer modal (for photo lightbox or post dialogs)
            if (this.hasActiveModal()) return 'modal';

            // 6. Top-level routes
            if (host.includes('messenger.com') || path.startsWith('/messages')) return 'messages';
            if (path.startsWith('/groups')) return 'groups';
            if (path.startsWith('/marketplace')) return 'marketplace';
            if (path.startsWith('/photo') || path.startsWith('/photos') || path.startsWith('/media/set')) return 'photos';

            // 7. Profile sub-tabs: /<username>/<tab>/ or ?sk=<tab>
            if (search.includes('sk=photos') || search.includes('tab=photos') || path.endsWith('/photos')) {
                return 'profile_photos';
            }
            if (search.includes('sk=videos') || search.includes('tab=videos') || path.endsWith('/videos')) {
                return 'profile_videos';
            }
            if (search.includes('tab=reels') || path.endsWith('/reels_tab')) {
                return 'profile_reels';
            }

            // 8. Main Feed vs Profile Timeline
            if (path === '/' || path === '') return 'feed';

            // Profile page check: /profile.php or single segment /<username>
            const segments = path.split('/').filter(Boolean);
            if (path.startsWith('/profile.php') || (segments.length === 1 && !['gaming', 'bookmarks', 'notifications'].includes(segments[0]))) {
                return 'profile_timeline';
            }

            return 'feed';
        },

        // Helper: Is this a profile section?
        isProfileSection(section) {
            return ['profile_timeline', 'profile_photos', 'profile_videos', 'profile_reels', 'friends'].includes(section);
        },

        // --- Corner Placement Config Per Section ---
        getPlatformConfig(path, media) {
            const section = this.getSection();

            // Determine if media is a Reel / vertical video (even inside modal or feed)
            const isReelMedia = section === 'reels' || (media && (
                (media.tagName && media.tagName.toLowerCase() === 'video' && (
                    (media.videoHeight && media.videoWidth && media.videoHeight > media.videoWidth * 1.05) ||
                    (media.offsetHeight && media.offsetWidth && media.offsetHeight > media.offsetWidth * 1.05) ||
                    media.closest('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reel"], [aria-label*="Reel" i]')
                ))
            ));

            if (isReelMedia) {
                // Top-right corner placed safely below Facebook's native circular search button.
                // Search button is at top: 12-52px, right: 16-20px.
                // Setting topOffset: 68 places buttons at y = 16 + 68 = 84px, directly below the search button.
                // This completely clears the horizontal sound/volume button on the left and search button on the right.
                return { 
                    preferredCorners: ['top-right', 'bottom-right'], 
                    padding: 16, 
                    topOffset: 68 
                };
            }

            if (section === 'modal') {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 14 };
            }
            if (section === 'watch') {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 16 };
            }
            if (section === 'stories') {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 16, topOffset: 48 };
            }
            if (section === 'feed') {
                return { preferredCorners: ['top-left', 'top-right', 'bottom-left'], padding: 12 };
            }
            if (section === 'groups') {
                return { preferredCorners: ['top-left', 'top-right', 'bottom-left'], padding: 12 };
            }
            if (section === 'friends') {
                return { preferredCorners: ['top-right', 'top-left'], padding: 8 };
            }
            if (section === 'profile_photos' || section === 'photos') {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 8 };
            }
            if (section === 'profile_videos') {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 10 };
            }
            if (section === 'messages') {
                return { preferredCorners: ['top-left', 'top-right'], padding: 8 };
            }

            return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
        },

        // --- Modal & Theater Mode Detection ---
        hasActiveModal() {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[data-pagelet="MediaViewer"]');
            for (const d of dialogs) {
                if (d.isConnected) {
                    const style = window.getComputedStyle(d);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                        const rect = d.getBoundingClientRect();
                        if (rect.width > window.innerWidth * 0.35 && rect.height > window.innerHeight * 0.35) {
                            return true;
                        }
                    }
                }
            }
            return false;
        },

        getActiveModal() {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[data-pagelet="MediaViewer"]');
            for (const d of dialogs) {
                if (d.isConnected) {
                    const rect = d.getBoundingClientRect();
                    if (rect.width > window.innerWidth * 0.35 && rect.height > window.innerHeight * 0.35) {
                        return d;
                    }
                }
            }
            return null;
        },

        isInsideModal(media) {
            if (!media) return false;
            const modal = media.closest('[role="dialog"], [aria-modal="true"], div[data-pagelet="MediaViewer"]');
            if (modal) return true;

            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[data-pagelet="MediaViewer"]');
            for (const d of dialogs) {
                if (d.contains(media)) return true;
            }
            return false;
        },

        getHoverHost(media) {
            if (!media) return null;

            // Theater viewer media host
            const viewer = media.closest('div[data-pagelet="MediaViewer"]');
            if (viewer) return viewer;

            // Individual Reel card tile in feed carousel (strictly bounded to card width <= 360px)
            const reelLink = media.closest('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reel"], div[aria-label*="Reel" i]');
            if (reelLink) {
                const r = reelLink.getBoundingClientRect();
                if (r.width >= 50 && r.width <= 360 && r.height >= 70) return reelLink;
            }

            // Walk up to find individual Reel card container (never escape into whole tray)
            let curr = media.parentElement;
            let cardHost = null;
            for (let i = 0; i < 7 && curr && curr !== document.body; i++) {
                const r = curr.getBoundingClientRect();
                if (r.width > 360) break; // Escaped into carousel container
                if (r.width >= 50 && r.height >= 70) {
                    cardHost = curr;
                }
                const label = (curr.getAttribute('aria-label') || '').toLowerCase();
                const pagelet = (curr.getAttribute('data-pagelet') || '').toLowerCase();
                if (label.includes('reel') || pagelet.startsWith('reel_') || pagelet.includes('reel')) {
                    if (r.width <= 360) return curr;
                }
                curr = curr.parentElement;
            }
            if (cardHost) return cardHost;

            // Friend card in /friends
            if (window.location.pathname.toLowerCase().startsWith('/friends') || this.getSection() === 'friends') {
                const friendCard = media.closest('div[role="listitem"], div[role="article"], a[role="link"], a[href*="/"], div.x1y1aw1k');
                if (friendCard) return friendCard;
            }

            // Direct photo links in feed or albums
            const photoLink = media.closest('a[href*="/photo/"], a[href*="/photo?"], a[href*="photo.php"]');
            if (photoLink) return photoLink;

            // Video player container with video ID
            const videoContainer = media.closest('div[data-video-id], div.x1y1aw1k');
            if (videoContainer) return videoContainer;

            // Post article container
            const article = media.closest('div[role="article"]');
            if (article) return article;

            const feedUnit = media.closest('div[data-pagelet*="FeedUnit"]');
            if (feedUnit) return feedUnit;

            const li = media.closest('li');
            if (li) return li;

            return null;
        },

        // --- Thumbnail & Eligibility Filtering ---
        isThumbnail(media) {
            if (!media) return true;
            const tagName = media.tagName.toLowerCase();
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width || rect.width;
            const naturalH = media.naturalHeight || media.height || rect.height;

            const section = this.getSection();

            // Settings pages only
            if (section === 'settings') {
                return true;
            }

            // Exclude completely hidden or zero-size elements
            if (section === 'friends') {
                if (rect.width < 32 || rect.height < 32) return true;
            } else {
                if (rect.width < 40 || rect.height < 40) return true;
                if (naturalW < 40 || naturalH < 40) return true;
            }

            // ==========================================
            // IMAGE FILTERING
            // ==========================================
            if (tagName === 'img' || tagName === 'image') {
                const src = (media.currentSrc || media.src || media.getAttribute('xlink:href') || media.getAttribute('href') || '').toLowerCase();

                // Exclude Facebook internal static assets, emoji sprite sheets, reaction icons
                if (
                    src.includes('rsrc.php') ||
                    src.includes('emoji.php') ||
                    src.includes('/reactions/') ||
                    src.includes('/images/emoji/') ||
                    src.includes('static.xx.fbcdn.net') ||
                    src.includes('blank.gif') ||
                    src.includes('spacer.gif') ||
                    src.startsWith('data:image/svg+xml')
                ) {
                    return true;
                }

                // Exclude small reaction icon badges on posts
                const isReaction = media.closest('[aria-label*="reaction" i], [role="toolbar"]');
                if (isReaction && (rect.width < 80 || rect.height < 80)) return true;

                // Exclude comment section user avatars (never in friends list)
                if (section !== 'friends') {
                    const inComments = media.closest('[aria-label*="comment" i], ul[role="group"], div[role="complementary"], div[aria-label*="replies" i]');
                    if (inComments && (rect.width < 120 && rect.height < 120)) {
                        return true;
                    }
                }

                // Exclude story tray avatar circles in feed header (only small avatar circles, not cards)
                const inStoryTray = media.closest('div[data-pagelet="Stories"], div[aria-label*="Stories" i], div[aria-label*="Create a story" i]');
                if (inStoryTray && section !== 'stories' && (rect.width < 70 || rect.height < 70)) {
                    return true;
                }

                // FRIENDS PAGE (/friends)
                if (section === 'friends') {
                    // Only exclude if inside top sticky header
                    const inTopBanner = media.closest('[role="banner"], header');
                    if (inTopBanner) return true;
                    if (rect.width >= 32 && rect.height >= 32) return false;
                    if (naturalW >= 32 && naturalH >= 32) return false;
                    return true;
                }

                // Profile Header: Allow Profile Picture & Cover Photo downloads
                const isProfilePic = media.closest('div[aria-label*="profile picture" i], a[aria-label*="profile picture" i], div[aria-label*="Profile photo" i], svg[aria-label*="profile picture" i]');
                if (isProfilePic) {
                    if (rect.width >= 50 || naturalW >= 50) return false;
                }

                const isCoverPhoto = media.closest('div[aria-label*="cover photo" i], div[aria-label*="Cover photo" i]');
                if (isCoverPhoto) {
                    if (rect.width >= 150 || naturalW >= 150) return false;
                }

                // Navigation & sidebar exclusions (never apply to friends list or profile pics)
                const inNav = media.closest('[role="banner"], [role="navigation"], header');
                if (inNav && section !== 'friends' && !isProfilePic && !isCoverPhoto) {
                    return true;
                }

                // MODAL / THEATER STATE
                if (section === 'modal') {
                    if (!this.isInsideModal(media)) return true;
                    if (rect.width < 150 || rect.height < 150) return true;
                    return false;
                }

                // FEED / GROUPS / TIMELINE
                if (section === 'feed' || section === 'groups' || section === 'profile_timeline') {
                    // Reel / Story carousel cards in feed
                    const isReelOrStoryCard = media.closest('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reels" i], div[data-pagelet*="Stories" i], div[data-pagelet*="Reel_"], div[aria-label*="Reels" i]');
                    if (isReelOrStoryCard) {
                        if (rect.width >= 50 && rect.height >= 70) return false;
                    }

                    const inArticle = media.closest('[role="article"], div[data-pagelet*="FeedUnit"]');
                    if (inArticle) {
                        if (rect.width >= 80 && rect.height >= 80) return false;
                    }
                    if (rect.width >= 90 && rect.height >= 90) return false;
                    return true;
                }

                // PHOTOS GRID / ALBUMS
                if (section === 'photos' || section === 'profile_photos') {
                    if (rect.width >= 60 && rect.height >= 60) return false;
                    return true;
                }

                // STORIES
                if (section === 'stories') {
                    const screenCenterX = window.innerWidth / 2;
                    const isCentered = rect.left <= screenCenterX && rect.right >= screenCenterX;
                    if (!isCentered) return true;
                    if (rect.width < 180) return true;
                    return false;
                }

                // MESSAGES / MESSENGER
                if (section === 'messages') {
                    if (rect.width < 100 || rect.height < 100) return true;
                    const style = window.getComputedStyle(media);
                    if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius) > 20)) {
                        return true;
                    }
                    return false;
                }

                // Fallback for images
                if (naturalW >= 140 && naturalH >= 140 && rect.width >= 90 && rect.height >= 90) return false;
                return true;
            }

            // ==========================================
            // VIDEO FILTERING
            // ==========================================
            if (tagName === 'video') {
                // MODAL STATE
                if (section === 'modal') {
                    if (!this.isInsideModal(media)) return true;
                    return false;
                }

                // REELS PAGE
                if (section === 'reels') {
                    const inViewport = rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
                    if (!inViewport) return true;
                    if (rect.height < 200) return true;
                    return false;
                }

                // STORIES PAGE
                if (section === 'stories') {
                    const screenCenterX = window.innerWidth / 2;
                    const isCentered = rect.left <= screenCenterX && rect.right >= screenCenterX;
                    if (!isCentered) return true;
                    if (rect.width < 180) return true;
                    return false;
                }

                // Reel / Story card tile in feed carousel
                const isReelOrStoryCard = media.closest('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reels" i], div[data-pagelet*="Stories" i], div[data-pagelet*="Reel_"], div[aria-label*="Reels" i]');
                if (isReelOrStoryCard) {
                    if (rect.width >= 50 && rect.height >= 70) return false;
                }

                // WATCH / FEED / GROUPS / TIMELINE
                if (rect.width >= 100 && rect.height >= 80) return false;
                return true;
            }

            return true;
        },

        // --- Button Scale Per Section ---
        getButtonScale(media) {
            const section = this.getSection();
            if (section === 'modal')          return 1.0;
            if (section === 'watch')          return 1.0;
            if (section === 'reels')          return 1.0;
            if (section === 'stories')        return 1.0;
            if (section === 'messages')       return 0.85;

            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);

            if (section === 'friends') {
                if (minSide < 70) return 0.65;
                if (minSide < 110) return 0.75;
                return 0.85;
            }

            if (section === 'photos' || section === 'profile_photos') {
                return 0.85;
            }

            if (minSide < 160) return 0.75;
            if (minSide < 260) return 0.85;
            return 1.0;
        },

        // --- React Fiber & DOM Extraction Helpers ---
        useDirectDownload: false,
        useReactThumbnail: true,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('//www.facebook.com') ||
                   lower.includes('//facebook.com') ||
                   lower.includes('//web.facebook.com') ||
                   lower.includes('//m.facebook.com') ||
                   lower.includes('//messenger.com');
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            if (!val || typeof val !== 'string') return true;
            const lowerVal = val.toLowerCase();
            if (this.isInternalUrl(lowerVal)) return true;
            if (lowerVal.includes('unified_cvc')) return true;
            if (lowerVal.includes('rsrc.php') || lowerVal.includes('emoji.php') || lowerVal.includes('reactions')) return true;
            if (lowerVal.includes('bytestart') || lowerVal.includes('byteend')) return true;
            if (lowerVal.includes('blurred') || lowerVal.includes('placeholder')) return true;
            if (isVideoContext && !this.isValidVideo(val)) return true;
            return false;
        },

        looksLikeReactImage(val, key) {
            if (!val || typeof val !== 'string') return false;
            const lowerVal = val.toLowerCase();
            const lowerKey = key.toLowerCase();
            if (this.isInternalUrl(lowerVal)) return false;

            const isImageKey = lowerKey.includes('image') ||
                               lowerKey.includes('photo') ||
                               lowerKey.includes('thumbnail') ||
                               lowerKey.includes('cover') ||
                               lowerKey.includes('display_url') ||
                               lowerKey.includes('uri');

            const isImageVal = lowerVal.includes('scontent') ||
                               lowerVal.includes('.jpg') ||
                               lowerVal.includes('.png') ||
                               lowerVal.includes('.webp') ||
                               lowerVal.includes('.heic') ||
                               (lowerVal.includes('fbcdn.net') && !lowerVal.includes('video'));

            const notVideo = !lowerVal.includes('.mp4') && !lowerVal.includes('video.fbcdn.net') && !lowerKey.includes('video');

            return (isImageKey || isImageVal) && notVideo;
        },

        looksLikeReactVideo(val, key) {
            if (!val || typeof val !== 'string') return false;
            return this.isValidVideo(val);
        },

        extractPriorityReactUrl(val, isVideoContext) {
            if (!val || typeof val !== 'object') return null;

            if (isVideoContext) {
                // 1. Facebook HD Progressive URL (highest quality master)
                const hdCandidates = [
                    val.playable_url_quality_hd,
                    val.browser_native_hd_url,
                    val.hd_src,
                    val.hd_src_no_ratelimit,
                    val.progressive_download_url
                ];
                for (const c of hdCandidates) {
                    if (typeof c === 'string') {
                        const clean = this.cleanVideoUrl(c);
                        if (clean && this.isValidVideo(clean)) return clean;
                    }
                }

                // 2. Multi-version video candidate array
                if (Array.isArray(val.video_versions) && val.video_versions.length > 0) {
                    const valid = val.video_versions
                        .map(v => (v && typeof v.url === 'string') ? this.cleanVideoUrl(v.url) : null)
                        .filter(u => u && this.isValidVideo(u));
                    if (valid.length > 0) {
                        return valid[0];
                    }
                }

                // 3. Facebook SD Progressive & Generic URLs
                const sdCandidates = [
                    val.playable_url,
                    val.browser_native_sd_url,
                    val.sd_src,
                    val.sd_src_no_ratelimit,
                    val.playback_url,
                    val.progressiveUrl,
                    val.streamingUrl,
                    val.video_url,
                    val.videoUrl
                ];
                for (const c of sdCandidates) {
                    if (typeof c === 'string') {
                        const clean = this.cleanVideoUrl(c);
                        if (clean && this.isValidVideo(clean)) return clean;
                    }
                }
            } else {
                // High-resolution photo candidates on Facebook
                if (val.viewer_image && typeof val.viewer_image.uri === 'string' && !val.viewer_image.uri.startsWith('blob:') && !this.isInternalUrl(val.viewer_image.uri)) {
                    return val.viewer_image.uri;
                }
                if (val.full_image && typeof val.full_image.uri === 'string' && !val.full_image.uri.startsWith('blob:') && !this.isInternalUrl(val.full_image.uri)) {
                    return val.full_image.uri;
                }
                if (val.large_image && typeof val.large_image.uri === 'string' && !val.large_image.uri.startsWith('blob:') && !this.isInternalUrl(val.large_image.uri)) {
                    return val.large_image.uri;
                }
                if (val.photo_image && typeof val.photo_image.uri === 'string' && !val.photo_image.uri.startsWith('blob:') && !this.isInternalUrl(val.photo_image.uri)) {
                    return val.photo_image.uri;
                }
                if (val.image && typeof val.image.uri === 'string' && !val.image.uri.startsWith('blob:') && !this.isInternalUrl(val.image.uri)) {
                    return val.image.uri;
                }

                if (Array.isArray(val.display_resources) && val.display_resources.length > 0) {
                    const valid = val.display_resources.filter(r => r && typeof r.src === 'string' && !r.src.startsWith('blob:') && !this.isInternalUrl(r.src));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
                        return valid[0].src;
                    }
                }
                if (typeof val.display_url === 'string' && val.display_url.startsWith('http') && !val.display_url.includes('blob:') && !this.isInternalUrl(val.display_url)) {
                    return val.display_url;
                }
                if (Array.isArray(val.candidates) && val.candidates.length > 0) {
                    const valid = val.candidates.filter(c => c && typeof c.url === 'string' && !c.url.startsWith('blob:') && !this.isInternalUrl(c.url));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.width || 0) - (a.width || 0));
                        return valid[0].url;
                    }
                }
                if (val.image_versions2 && Array.isArray(val.image_versions2.candidates) && val.image_versions2.candidates.length > 0) {
                    const valid = val.image_versions2.candidates.filter(c => c && typeof c.url === 'string' && !c.url.startsWith('blob:') && !this.isInternalUrl(c.url));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.width || 0) - (a.width || 0));
                        return valid[0].url;
                    }
                }
            }
            return null;
        },

        filterBackgroundUrls(candidates, isVideo) {
            return candidates.filter(u => {
                if (isVideo) {
                    return this.isValidVideo(u);
                } else {
                    const lower = (u || '').toLowerCase();
                    if (lower.includes('.mp4') || lower.includes('video.fbcdn.net')) return false;
                    return lower.includes('scontent') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp');
                }
            });
        },

        getInterceptUrls() {
            return ['facebook.com', 'fbcdn.net', 'graph.', '/api/graphql', '/ajax/', 'graphql'];
        },

        // --- DOM / Script Tag Video Extractor for Facebook ---
        extractVideoUrlFromDOM(el) {
            if (!el) return null;

            const parseScriptText = (text) => {
                if (!text) return null;

                // 1. Check playable_url_quality_hd
                const hdMatch = text.match(/"playable_url_quality_hd"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (hdMatch && hdMatch[1]) {
                    try {
                        const raw = JSON.parse('"' + hdMatch[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(hdMatch[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                // 2. Check browser_native_hd_url
                const nativeHdMatch = text.match(/"browser_native_hd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (nativeHdMatch && nativeHdMatch[1]) {
                    try {
                        const raw = JSON.parse('"' + nativeHdMatch[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(nativeHdMatch[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                // 3. Check progressive_download_url
                const progMatch = text.match(/"progressive_download_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (progMatch && progMatch[1]) {
                    try {
                        const raw = JSON.parse('"' + progMatch[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(progMatch[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                // 4. Check playable_url (SD)
                const sdMatch = text.match(/"playable_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (sdMatch && sdMatch[1]) {
                    try {
                        const raw = JSON.parse('"' + sdMatch[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(sdMatch[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                // 5. Check browser_native_sd_url
                const nativeSdMatch = text.match(/"browser_native_sd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (nativeSdMatch && nativeSdMatch[1]) {
                    try {
                        const raw = JSON.parse('"' + nativeSdMatch[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(nativeSdMatch[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                // 6. Direct regex search for CDN MP4
                const cdnRegex = /"(https:(?:\\\/\\\/|\/\/)[^"]+?(?:fbcdn\.net|fbsbx\.com)[^"]+?\.(?:mp4|m4v)[^"]*)"/g;
                let cdnM;
                while ((cdnM = cdnRegex.exec(text)) !== null) {
                    try {
                        const raw = JSON.parse('"' + cdnM[1] + '"');
                        const clean = this.cleanVideoUrl(raw);
                        if (this.isValidVideo(clean)) return clean;
                    } catch(e) {
                        const clean = this.cleanVideoUrl(cdnM[1]);
                        if (this.isValidVideo(clean)) return clean;
                    }
                }

                return null;
            };

            // 1. Identify Video ID if available
            let videoId = null;
            let current = el;
            for (let i = 0; i < 10 && current; i++) {
                if (current.dataset && (current.dataset.videoId || current.dataset.video_id)) {
                    videoId = current.dataset.videoId || current.dataset.video_id;
                    break;
                }
                const link = current.querySelector ? current.querySelector('a[href*="/videos/"], a[href*="/watch/"], a[href*="/reel/"]') : null;
                if (link && link.href) {
                    const m = link.href.match(/(?:videos|watch\/?\?v=|reel\/)(\d+)/);
                    if (m) { videoId = m[1]; break; }
                }
                current = current.parentElement;
            }

            if (!videoId) {
                const urlMatch = window.location.href.match(/(?:videos|watch\/?\?v=|reel\/)(\d+)/);
                if (urlMatch) videoId = urlMatch[1];
            }

            const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');

            // Pass 1: Scan scripts containing the videoId
            if (videoId) {
                for (const s of scripts) {
                    const text = s.textContent;
                    if (text && text.includes(videoId)) {
                        const found = parseScriptText(text);
                        if (found) return found;
                    }
                }
            }

            // Pass 2: Scan scripts with high-confidence playable keys
            for (const s of scripts) {
                const text = s.textContent;
                if (text && (text.includes('playable_url_quality_hd') || text.includes('browser_native_hd_url') || text.includes('progressive_download_url') || text.includes('playable_url'))) {
                    const found = parseScriptText(text);
                    if (found) return found;
                }
            }

            return null;
        }
    };

    window.ToystallerPlatforms['facebook'] = facebookPlatform;
    window.ToystallerPlatform = facebookPlatform;
    window.ToystallerActivePlatform = facebookPlatform;
})();
