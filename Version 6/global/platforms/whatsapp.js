// platforms/whatsapp.js
// Specialized WhatsApp Platform Layer for Toystaller v1.0
// Supports: Chat Conversation Messages, Status/Stories Viewer, Fullscreen Media Lightbox, and Contact Info Drawer.

window.ToystallerPlatforms = window.ToystallerPlatforms || {};

(function() {
    const whatsappPlatform = {
        name: 'whatsapp',
        version: 'v1.0',
        specialization: 'WhatsApp Web media extraction — Chats, Status, and Media Lightbox.',

        // --- Route & Section Detection ---
        getSection(targetMedia) {
            // Check specific element context first if provided
            if (targetMedia && targetMedia.nodeType) {
                // Priority 1: Fullscreen status / story viewer
                if (targetMedia.closest('[data-animate-status-v3="true"], div[data-testid="status-v3-main"], div[data-testid="status-viewer"], div[aria-label*="Status" i]')) {
                    return 'wa-status';
                }
                const dialog = targetMedia.closest('div[role="dialog"], div[role="region"], div.app-wrapper-web');
                if (dialog) {
                    const hasReply = dialog.querySelector('input[placeholder*="reply" i], div[title*="reply" i], div[data-testid="status-reply-box"]');
                    const hasStatusProgress = dialog.querySelector('[data-testid="status-progress-bar"], [data-testid="status-header"], div[aria-label*="Status" i]');
                    const hasStoryControls = dialog.querySelector('button[aria-label*="Pause" i], button[aria-label*="Play" i]');
                    const isLightbox = dialog.querySelector('[data-testid="media-viewer"], [data-animate-media-viewer="true"]');
                    
                    if (!isLightbox && (hasReply || hasStatusProgress || hasStoryControls)) {
                        return 'wa-status';
                    }
                    if (isLightbox || dialog.querySelector('button[aria-label*="Forward" i], button[aria-label*="Star" i]')) {
                        return 'wa-media-viewer';
                    }
                }

                // Main conversation chat messages
                if (targetMedia.closest('div[role="row"], div[data-testid="msg-container"], div[data-id], div.message-in, div.message-out, div[data-testid="conversation-panel-messages"]')) {
                    return 'wa-chat';
                }

                // Contact / Group info drawer
                if (targetMedia.closest('div[data-testid="drawer-right"], div[data-testid="chat-info-drawer"], div[data-testid="contact-info"]')) {
                    return 'wa-profile';
                }
            }

            // Global page-level checks:
            // Status check MUST take precedence over generic dialogs
            if (document.querySelector('[data-animate-status-v3="true"], div[data-testid="status-v3-main"], div[data-testid="status-viewer"], div[data-testid="status-reply-box"]') ||
                document.querySelector('input[placeholder*="reply" i], div[title*="reply" i]')) {
                return 'wa-status';
            }

            // Media lightbox viewer
            if (document.querySelector('[data-animate-media-viewer="true"], div[data-testid="media-viewer"], div[data-testid="media-viewer-modal"]')) {
                return 'wa-media-viewer';
            }

            // Contact / Group info drawer (wa-profile)
            if (document.querySelector('div[data-testid="drawer-right"], div[data-testid="chat-info-drawer"], div[data-testid="contact-info"]')) {
                return 'wa-profile';
            }

            // Main active conversation message stream
            if (document.querySelector('div[data-testid="conversation-panel-messages"], div[role="region"][aria-label*="Message" i], div[data-testid="conversation-panel-body"]')) {
                return 'wa-chat';
            }

            return 'whatsapp'; // General fallback
        },

        // --- Corner Placement Config Per Section ---
        getPlatformConfig(sectionOrMedia) {
            let section = typeof sectionOrMedia === 'string' ? sectionOrMedia : this.getSection(sectionOrMedia);

            if (section === 'wa-status') {
                // Clear WhatsApp status top header (progress bar, contact info, play/pause/mute buttons)
                // and bottom reply drawer ("Type a reply...")
                return { 
                    preferredCorners: ['top-right', 'top-left'], 
                    padding: 16, 
                    topOffset: 75,     // Safe distance below native ~65px status header
                    bottomOffset: 80   // Safe distance above bottom "Type a reply..." input
                };
            }
            if (section === 'wa-media-viewer') {
                // Keep buttons clear of WhatsApp top-right controls (Close, Forward, Star)
                return { 
                    preferredCorners: ['top-left', 'top-right', 'bottom-right'], 
                    padding: 16, 
                    topOffset: 72,
                    bottomOffset: 60
                };
            }
            if (section === 'wa-chat') {
                return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 8 };
            }
            
            return { preferredCorners: ['top-right', 'top-left', 'bottom-right'], padding: 10 };
        },

        // --- Modal Detection ---
        _modalSelector: '[data-animate-media-viewer="true"], div[role="dialog"], div[data-testid="media-viewer"], div[data-testid="media-viewer-modal"], [data-animate-status-v3="true"], div[data-testid="status-v3-main"], div[data-testid="status-viewer"]',

        hasActiveModal() {
            const viewer = document.querySelector(this._modalSelector);
            if (!viewer || !viewer.isConnected) return false;
            
            // Note: Fixed-position elements have offsetParent === null in Blink/WebKit!
            // We verify visibility via getComputedStyle and bounding dimensions.
            const style = window.getComputedStyle(viewer);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = viewer.getBoundingClientRect();
            return rect.width > 50 && rect.height > 50;
        },

        getActiveModal() {
            return this.hasActiveModal() ? document.querySelector(this._modalSelector) : null;
        },

        isInsideModal(media) {
            if (!media) return false;
            const modal = media.closest(this._modalSelector);
            return modal !== null;
        },

        // --- Thumbnail / Eligibility Filter (per section) ---
        isThumbnail(media) {
            if (!media) return true;
            const rect = media.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return true;

            const section = this.getSection(media);

            // Strict isolation: if a modal (status or lightbox) is active, only allow media inside it
            if (this.hasActiveModal()) {
                if (!this.isInsideModal(media)) return true;
                
                // Exclude tiny UI icons or small avatars inside the modal
                if (rect.width < 70 || rect.height < 70) return true;
                return false;
            }

            // Exclude circular avatars in chat list / sidebar (pane-side)
            if (media.closest('#pane-side, div[data-testid="chat-list"], div[data-testid="cell-frame-container"]')) {
                return true;
            }

            // Exclude avatars with border-radius 50% or small dimensions
            if (rect.width <= 60 && rect.height <= 60) {
                return true;
            }

            // Exclude emojis, stickers, reaction badges
            if (media.src && (media.src.includes('sticker') || media.src.includes('emoji'))) return true;
            if (media.alt && media.alt.length <= 4 && rect.width < 60) return true;
            if (rect.width < 50 || rect.height < 50) return true;

            // Target valid post media in messages
            if (section === 'wa-chat' || media.closest('div[role="row"], div[data-testid="msg-container"], div[data-id], div.message-in, div.message-out')) {
                if (Math.max(rect.width, rect.height) >= 90) return false;
                return true;
            }

            // Media in drawer right (contact info media grid)
            if (section === 'wa-profile') {
                if (rect.width >= 70 && rect.height >= 70) return false;
            }

            if (Math.max(rect.width, rect.height) >= 90) return false;
            return true;
        },

        // --- Button Scale Per Section ---
        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            
            if (minSide < 160) return 0.8;
            if (minSide < 240) return 0.9;
            return 1.0;
        },

        // --- Extraction Config ---
        useDirectDownload: false,
        useReactThumbnail: false,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('web.whatsapp.com') || lower.includes('.whatsapp.net');
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            return false;
        },
        looksLikeReactImage(val, key) {
            return false;
        },
        looksLikeReactVideo(val, key) {
            return false;
        },
        extractPriorityReactUrl(val, isVideoContext) {
            return null;
        },
        filterBackgroundUrls(candidates, isVideo) {
            return candidates;
        },
        extractVideoUrlFromDOM(el) {
            if (el && el.tagName && el.tagName.toLowerCase() === 'video') {
                return el.currentSrc || el.src;
            }
            return null;
        }
    };

    window.ToystallerPlatforms['whatsapp'] = whatsappPlatform;
    window.ToystallerPlatform = whatsappPlatform;
    window.ToystallerActivePlatform = whatsappPlatform;
})();
