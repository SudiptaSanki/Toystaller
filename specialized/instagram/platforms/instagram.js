window.ToystallerPlatforms = window.ToystallerPlatforms || {};

(function() {
    // ============================================================
    // Instagram Section Route Map (v6.1)
    // ============================================================
    //
    // URL Pattern                                    → Section
    // ──────────────────────────────────────────────────────────────
    // [Any URL when dialog open]                     → modal
    // /                                              → feed
    // /reels/ or /reel/<id>/                         → reels
    // /stories/<username>/<id>/                      → stories
    // /direct/ or /direct/inbox/ or /direct/t/<id>/  → direct
    // /explore/ or /explore/tags/<tag>/               → explore
    // /p/<shortcode>/ or /tv/<id>/                   → post_standalone
    // /<username>/                                   → profile_posts  (default grid)
    // /<username>/reels/                             → profile_reels
    // /<username>/tagged/                            → profile_tagged
    // /<username>/saved/                             → profile_saved
    // /<username>/reposts/                           → profile_reposts
    // /<username>/channels/                          → profile_channels
    // /<username>/followers/ or /following/           → profile_social
    // /accounts/*, /nametag/, /session/login/        → settings (ignored)
    // ============================================================

    const instagramPlatform = {
        name: 'instagram',
        version: 'v6.1',
        specialization: 'Per-page Instagram media extraction — Profile Posts, Profile Reels, Tagged, Reposts, Saved, Feed, Reels Player, Stories, DMs, Explore, Post Modals, and Standalone Posts.',

        // --- Route & Section Detection ---
        getSection() {
            const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';

            // 1. Modal always takes priority (post/reel opened as dialog overlay)
            if (this.hasActiveModal()) return 'modal';

            // 2. Top-level fixed routes
            if (path === '/' || path === '') return 'feed';
            if (path.startsWith('/reels') || path.startsWith('/reel/')) return 'reels';
            if (path.startsWith('/stories/')) return 'stories';
            if (path.startsWith('/direct/')) return 'direct';
            if (path.startsWith('/explore/')) return 'explore';
            if (path.startsWith('/p/') || path.startsWith('/tv/')) return 'post_standalone';

            // 3. Settings / non-media pages — skip entirely
            if (path.startsWith('/accounts/') || path.startsWith('/nametag') ||
                path.startsWith('/session/') || path.startsWith('/emails/') ||
                path.startsWith('/legal/') || path.startsWith('/about/') ||
                path.startsWith('/developer/') || path.startsWith('/web/')) {
                return 'settings';
            }

            // 4. Profile sub-pages: /<username>/<tab>/
            //    Extract the second segment after the username
            const segments = path.split('/').filter(Boolean);
            if (segments.length >= 2) {
                const tab = segments[1];
                if (tab === 'reels')     return 'profile_reels';
                if (tab === 'tagged')    return 'profile_tagged';
                if (tab === 'saved')     return 'profile_saved';
                if (tab === 'reposts')   return 'profile_reposts';
                if (tab === 'channels')  return 'profile_channels';
                if (tab === 'followers' || tab === 'following' || tab === 'mutualfollowers')
                    return 'profile_social';
                if (tab === 'guides')    return 'profile_guides';
            }

            // 5. Default: /<username>/ — main profile posts grid
            return 'profile_posts';
        },

        // Helper: Is this a profile-type page (any tab)?
        isProfileSection(section) {
            return section && section.startsWith('profile_');
        },

        // Helper: Is this a grid-based profile tab (posts, reels, tagged, reposts, saved)?
        isProfileGridSection(section) {
            return ['profile_posts', 'profile_reels', 'profile_tagged', 'profile_reposts', 'profile_saved'].includes(section);
        },

        // --- Corner Placement Config Per Section ---
        getPlatformConfig(path) {
            const section = this.getSection();

            if (section === 'modal') {
                return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 14 };
            }
            if (section === 'reels') {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 16 };
            }
            if (section === 'stories') {
                return { preferredCorners: ['top-left', 'top-left'], padding: 16, topOffset: 48 };
            }
            if (section === 'direct') {
                return { preferredCorners: ['top-left', 'top-right'], padding: 8 };
            }
            if (section === 'explore') {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 6 };
            }
            if (section === 'post_standalone') {
                return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
            }
            // All profile grid tabs
            if (this.isProfileGridSection(section)) {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 8 };
            }
            // profile_social, profile_channels, profile_guides, settings
            return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
        },

        // --- Modal Detection ---
        hasActiveModal() {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
            for (const d of dialogs) {
                if (d.isConnected) {
                    const style = window.getComputedStyle(d);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                        const rect = d.getBoundingClientRect();
                        // A post modal usually covers most of the screen
                        if (rect.width > window.innerWidth * 0.4 && rect.height > window.innerHeight * 0.4) {
                            return true;
                        }
                    }
                }
            }
            return false;
        },

        getActiveModal() {
            return document.querySelector('[role="dialog"], [aria-modal="true"]');
        },

        isInsideModal(media) {
            if (!media) return false;
            const modal = media.closest('[role="dialog"], [aria-modal="true"]');
            if (modal) return true;
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
            for (const d of dialogs) {
                if (d.contains(media)) return true;
            }
            return false;
        },

        getHoverHost(media) {
            const aagv = media.closest('div._aagv');
            if (aagv) return aagv;
            
            const li = media.closest('li');
            if (li) return li;
            
            return null;
        },

        // --- Thumbnail / Eligibility Filter (per section) ---
        isThumbnail(media) {
            if (!media) return true;
            const tagName = media.tagName.toLowerCase();
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width || rect.width;
            const naturalH = media.naturalHeight || media.height || rect.height;

            const section = this.getSection();

            // ==========================================
            // SETTINGS / SOCIAL pages — no media to extract
            // ==========================================
            if (section === 'settings' || section === 'profile_social' || section === 'profile_guides') {
                return true;
            }

            // ==========================================
            // MODAL STATE (Post/Reel open in dialog)
            // ==========================================
            if (section === 'modal') {
                if (!this.isInsideModal(media)) return true;

                // Inside modal: Exclude avatars and small UI elements
                if (rect.width < 90 || rect.height < 90) return true;
                if (naturalW < 90 || naturalH < 90) return true;

                // Exclude avatars inside comments list
                const inComments = media.closest('ul:not([class*="carousel" i]), [aria-label*="comment" i], [role="log"]');
                if (inComments) {
                    const isCarouselSlide = media.closest('li[tabindex], li[class*="carousel" i], ul > li:only-child');
                    if (!isCarouselSlide && rect.width < 200) return true;
                }

                // Carousel check removed: overlay_manager.js handles clipping and IntersectionObserver natively.

                const role = (media.getAttribute('role') || '').toLowerCase();
                if (role === 'presentation' || role === 'none') {
                    if (rect.width < 150) return true;
                }

                return false;
            }

            // ==========================================
            // PROFILE POSTS GRID (/<username>/)
            // ==========================================
            if (section === 'profile_posts') {
                // Header profile picture
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false; // Profile picture is downloadable
                }

                // Exclude story highlights circles
                const isHighlight = media.closest('[role="menu"], [aria-label*="highlight" i]');
                if (isHighlight) return true;

                // Grid post tiles
                const isGridPost = media.closest('a[href^="/p/"], a[href^="/reel/"], article');
                if (isGridPost) {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // PROFILE REELS TAB (/<username>/reels/)
            // ==========================================
            if (section === 'profile_reels') {
                // Header profile picture
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false;
                }

                // Exclude story highlights
                const isHighlight = media.closest('[role="menu"], [aria-label*="highlight" i]');
                if (isHighlight) return true;

                // Reel thumbnail tiles in the grid — typically <video poster> or cover <img>
                const isReelTile = media.closest('a[href^="/reel/"], a[href^="/p/"], article');
                if (isReelTile) {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                // Videos playing inline in the grid (hover previews)
                if (tagName === 'video') {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // PROFILE TAGGED TAB (/<username>/tagged/)
            // ==========================================
            if (section === 'profile_tagged') {
                // Header avatar
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false;
                }

                // Highlights
                const isHighlight = media.closest('[role="menu"], [aria-label*="highlight" i]');
                if (isHighlight) return true;

                // Tagged photo grid tiles
                const isGridPost = media.closest('a[href^="/p/"], a[href^="/reel/"], article');
                if (isGridPost) {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // PROFILE REPOSTS TAB (/<username>/reposts/)
            // ==========================================
            if (section === 'profile_reposts') {
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false;
                }

                const isHighlight = media.closest('[role="menu"], [aria-label*="highlight" i]');
                if (isHighlight) return true;

                const isGridPost = media.closest('a[href^="/p/"], a[href^="/reel/"], article');
                if (isGridPost) {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // PROFILE SAVED TAB (/<username>/saved/)
            // ==========================================
            if (section === 'profile_saved') {
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false;
                }

                const isHighlight = media.closest('[role="menu"], [aria-label*="highlight" i]');
                if (isHighlight) return true;

                // Saved collections may show collection cover images
                const isGridPost = media.closest('a[href^="/p/"], a[href^="/reel/"], a[href*="/saved/"], article');
                if (isGridPost) {
                    if (rect.width < 80 || rect.height < 80) return true;
                    return false;
                }

                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // PROFILE CHANNELS TAB (/<username>/channels/)
            // ==========================================
            if (section === 'profile_channels') {
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) {
                    if (rect.width < 60 || naturalW < 60) return true;
                    return false;
                }

                // Channel broadcast media
                if (rect.width < 150 || rect.height < 120) return true;

                // Exclude small circular avatars
                const style = window.getComputedStyle(media);
                if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius) > 30)) {
                    if (rect.width < 80) return true;
                }

                return false;
            }

            // ==========================================
            // REELS PAGE (/reels/, /reel/<id>/)
            // ==========================================
            if (section === 'reels') {
                if (tagName === 'video') {
                    // Only target the main vertical reel video currently visible in viewport
                    const inViewport = rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
                    if (!inViewport) return true;
                    if (rect.height < 300) return true;
                    return false;
                }
                // Thumbnails in reels page (suggested side reels) are excluded
                if (rect.width < 250) return true;
                return false;
            }

            // ==========================================
            // FEED HOME PAGE (/)
            // ==========================================
            if (section === 'feed') {
                // Exclude stories tray at top
                const inStoriesTray = media.closest('[role="menu"], [aria-label*="stories" i], header');
                if (inStoriesTray) return true;

                // Exclude post author avatar
                if (rect.width < 80 || rect.height < 80) return true;

                // Main post in feed
                const inFeedPost = media.closest('article');
                if (inFeedPost) {
                    if (rect.width < 150) return true;
                    return false;
                }

                if (rect.width < 150 || rect.height < 150) return true;
                return false;
            }

            // ==========================================
            // STANDALONE POST PAGE (/p/<shortcode>/)
            // ==========================================
            if (section === 'post_standalone') {
                // Post author avatar
                if (rect.width < 80 || rect.height < 80) return true;
                if (naturalW < 80 || naturalH < 80) return true;

                // Comment section avatars
                const inComments = media.closest('ul:not([class*="carousel" i]), [aria-label*="comment" i], [role="log"]');
                if (inComments) {
                    const isCarouselSlide = media.closest('li[tabindex], li[class*="carousel" i], ul > li:only-child');
                    if (!isCarouselSlide && rect.width < 200) return true;
                }

                // Carousel check removed: overlay_manager.js handles clipping and IntersectionObserver natively.

                // Suggested posts below — still downloadable if large enough
                const inArticle = media.closest('article');
                if (inArticle) {
                    if (rect.width < 150) return true;
                    return false;
                }

                if (rect.width < 150 || rect.height < 150) return true;
                return false;
            }

            // ==========================================
            // STORIES PAGE (/stories/)
            // ==========================================
            if (section === 'stories') {
                const screenCenterX = window.innerWidth / 2;
                const isCentered = rect.left <= screenCenterX && rect.right >= screenCenterX;
                if (!isCentered) return true;
                if (rect.width < 200) return true;
                return false;
            }

            // ==========================================
            // DIRECT MESSAGES (/direct/)
            // ==========================================
            if (section === 'direct') {
                if (rect.width < 150 || rect.height < 120) return true;

                // Exclude contact list avatars in sidebar
                const inNav = media.closest('[role="list"], [role="listbox"], [role="navigation"]');
                if (inNav) return true;

                // Exclude circular profile pictures in chat
                const style = window.getComputedStyle(media);
                if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius) > 30)) return true;

                return false;
            }

            // ==========================================
            // EXPLORE PAGE (/explore/)
            // ==========================================
            if (section === 'explore') {
                // Explore grid has a mosaic of images/videos of varying sizes
                if (rect.width < 80 || rect.height < 80) return true;

                const isGridItem = media.closest('a[href^="/p/"], a[href^="/reel/"], article');
                if (isGridItem) {
                    return false; // All explore grid items are downloadable
                }

                // Avatars and other small elements
                if (rect.width < 120 || rect.height < 120) return true;
                return false;
            }

            // ==========================================
            // DEFAULT FALLBACK
            // ==========================================
            if (naturalW >= 150 && naturalH >= 150 && rect.width >= 100 && rect.height >= 100) return false;
            return true;
        },

        // --- Button Scale Per Section ---
        getButtonScale(media) {
            const section = this.getSection();
            if (section === 'modal')          return 1.0;
            if (section === 'reels')          return 1.0;
            if (section === 'post_standalone') return 1.0;
            if (section === 'stories')        return 1.0;
            if (section === 'direct')         return 0.85;
            if (section === 'explore')        return 0.85;

            // Profile tabs
            if (this.isProfileSection(section)) {
                const isHeaderAvatar = media.closest('header');
                if (isHeaderAvatar) return 0.85;
                return 0.9; // Clearly visible buttons inside grid tiles
            }

            // Dynamic scaling based on media size
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.75;
            if (minSide < 280) return 0.85;
            return 1.0;
        },

        // --- React Fiber Extraction ---
        useDirectDownload: false,
        useReactThumbnail: true,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('//www.instagram.com') || lower.includes('//instagram.com');
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            const lowerVal = val.toLowerCase();
            return lowerVal.includes('//www.instagram.com') || lowerVal.includes('//instagram.com');
        },

        looksLikeReactImage(val, key) {
            const lowerVal = val.toLowerCase();
            const lowerKey = key.toLowerCase();
            return (
                lowerKey.includes('image') ||
                lowerKey.includes('thumbnail') ||
                lowerKey.includes('cover') ||
                lowerKey.includes('display_url') ||
                lowerVal.includes('.jpg') ||
                lowerVal.includes('.png') ||
                lowerVal.includes('.webp') ||
                lowerVal.includes('.heic') ||
                lowerVal.includes('/image/') ||
                (lowerVal.includes('cdninstagram.com') && !lowerVal.includes('video'))
            );
        },

        looksLikeReactVideo(val, key) {
            const lowerVal = val.toLowerCase();
            return (lowerVal.includes('cdninstagram.com') && lowerVal.includes('video')) || lowerVal.includes('.mp4');
        },

        extractPriorityReactUrl(val, isVideoContext) {
            if (!val || typeof val !== 'object') return null;

            if (isVideoContext) {
                if (Array.isArray(val.video_versions) && val.video_versions.length > 0) {
                    const valid = val.video_versions.filter(v => v && typeof v.url === 'string' && !v.url.startsWith('blob:'));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.height || 0) - (a.height || 0));
                        return valid[0].url;
                    }
                }
                if (typeof val.video_url === 'string' && val.video_url.startsWith('http') && !val.video_url.includes('blob:')) {
                    return val.video_url;
                }
                if (typeof val.videoUrl === 'string' && val.videoUrl.startsWith('http') && !val.videoUrl.includes('blob:')) {
                    return val.videoUrl;
                }
                if (typeof val.playback_url === 'string' && val.playback_url.startsWith('http') && !val.playback_url.includes('blob:')) {
                    return val.playback_url;
                }
                if (typeof val.progressiveUrl === 'string' && val.progressiveUrl.startsWith('http')) {
                    return val.progressiveUrl;
                }
                if (typeof val.streamingUrl === 'string' && val.streamingUrl.startsWith('http')) {
                    return val.streamingUrl;
                }
            } else {
                if (val.image_versions2 && Array.isArray(val.image_versions2.candidates) && val.image_versions2.candidates.length > 0) {
                    const valid = val.image_versions2.candidates.filter(c => c && typeof c.url === 'string' && !c.url.startsWith('blob:'));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.width || 0) - (a.width || 0));
                        return valid[0].url;
                    }
                }
                if (typeof val.display_url === 'string' && val.display_url.startsWith('http') && !val.display_url.includes('blob:')) {
                    return val.display_url;
                }
                if (Array.isArray(val.display_resources) && val.display_resources.length > 0) {
                    const valid = val.display_resources.filter(r => r && typeof r.src === 'string' && !r.src.startsWith('blob:'));
                    if (valid.length > 0) {
                        valid.sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
                        return valid[0].src;
                    }
                }
                if (Array.isArray(val.candidates) && val.candidates.length > 0) {
                    const valid = val.candidates.filter(c => c && typeof c.url === 'string' && !c.url.startsWith('blob:'));
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
                const lower = u.toLowerCase();
                if (lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp')) return false;
                return lower.includes('cdninstagram.com') || lower.includes('.mp4');
            });
        },

        extractVideoUrlFromDOM(el) {
            return null;
        }
    };

    window.ToystallerPlatforms['instagram'] = instagramPlatform;
    window.ToystallerPlatform = instagramPlatform;
    window.ToystallerActivePlatform = instagramPlatform;
})();
