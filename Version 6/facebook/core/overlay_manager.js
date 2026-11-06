// overlay_manager.js
// Tracks media elements and positions action buttons safely on document.body.
// v4: Section-aware modal suppression, zero-bleed backdrop isolation, smart corner placement,
//     clamped-inside-frame positioning, per-section toggle support.

class OverlayManager {
    constructor() {
        this.overlays = new Map();
        this.activeEntry = null;
        this.hideTimeout = null;

        // Per-section toggle settings (loaded from chrome.storage)
        this._sectionToggles = {
            toystaller_fb_show_feed:    true,
            toystaller_fb_show_watch:   true,
            toystaller_fb_show_reels:   true,
            toystaller_fb_show_stories: true,
            toystaller_fb_show_photos:  true
        };
        this._loadToggles();

        // Listen for settings changes from popup
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((msg) => {
                if (msg && msg.action === 'toystaller_settings_changed') {
                    this._sectionToggles[msg.key] = msg.value;
                    this.updateAllPositions();
                }
            });
        }

        this._onMouseMove = this._throttle(this._handlePointerMove.bind(this), 30);
        document.addEventListener('mousemove', this._onMouseMove, true);
        document.addEventListener('pointermove', this._onMouseMove, true);

        window.addEventListener('scroll', () => {
            if (this.activeEntry) {
                this._hide(this.activeEntry);
                this.activeEntry = null;
            }
            this.updateAllPositions();
        }, { passive: true, capture: true });
        window.addEventListener('resize', () => this.updateAllPositions());

        // Instant modal listener — when a dialog/modal opens or closes, immediately sync overlay visibility
        this._modalObserver = new MutationObserver(() => {
            this.updateAllPositions();
        });
        const obsTarget = document.documentElement || document.body;
        if (obsTarget) {
            this._modalObserver.observe(obsTarget, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['role', 'aria-modal', 'class']
            });
        }

        setInterval(() => this.updateAllPositions(), 1000);
    }

    _loadToggles() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(Object.keys(this._sectionToggles), (result) => {
                    if (chrome.runtime.lastError) return;
                    for (const key of Object.keys(this._sectionToggles)) {
                        if (result[key] !== undefined && result[key] !== null) {
                            this._sectionToggles[key] = result[key];
                        }
                    }
                    this.updateAllPositions();
                });
            }
        } catch(e) { /* storage unavailable */ }
    }

    _isSectionDisabledByToggle() {
        const platform = this._getPlatform();
        if (!platform || !platform.getSection) return false;
        const section = platform.getSection();

        // Modals (Theater mode) are ALWAYS enabled (never toggled off)
        if (section === 'modal') return false;

        // Map sections to toggle keys
        if (section === 'feed' || section === 'groups') return !this._sectionToggles.toystaller_fb_show_feed;
        if (section === 'watch') return !this._sectionToggles.toystaller_fb_show_watch;
        if (section === 'reels') return !this._sectionToggles.toystaller_fb_show_reels;
        if (section === 'stories') return !this._sectionToggles.toystaller_fb_show_stories;
        if (section === 'photos' || section.startsWith('profile_') || section === 'friends') return !this._sectionToggles.toystaller_fb_show_photos;

        return false;
    }

    _getTopNavHeight() {
        const banner = document.querySelector('header[role="banner"], div[role="banner"], [role="banner"], #header');
        if (banner) {
            const bRect = banner.getBoundingClientRect();
            if (bRect.top <= 10 && bRect.bottom >= 40 && bRect.bottom <= 120) {
                return bRect.bottom;
            }
        }
        return 56;
    }

    _getPlatform() {
        if (typeof PlatformManager !== 'undefined') {
            return PlatformManager.getPlatform();
        }
        if (window.ToystallerActivePlatform) {
            return window.ToystallerActivePlatform;
        }
        if (window.ToystallerPlatforms && window.ToystallerPlatforms['facebook']) {
            return window.ToystallerPlatforms['facebook'];
        }
        return null;
    }

    _throttle(fn, ms) {
        let last = 0;
        let pending = null;
        return (...args) => {
            const now = Date.now();
            const run = () => {
                last = Date.now();
                pending = null;
                fn(...args);
            };
            if (now - last >= ms) {
                run();
            } else if (!pending) {
                pending = setTimeout(run, ms - (now - last));
            }
        };
    }

    _findHoverHost(media) {
        const platform = this._getPlatform();
        if (platform && platform.getHoverHost) {
            const host = platform.getHoverHost(media);
            if (host && host.isConnected) {
                const hostRect = host.getBoundingClientRect();
                const mediaRect = media.getBoundingClientRect();
                const section = platform.getSection ? platform.getSection() : '';
                // In friends list or card grids, the host card is naturally wider than the avatar
                if (section === 'friends' && hostRect.width > 0 && hostRect.height > 0) {
                    return host;
                }
                if (mediaRect.width > 0 && hostRect.width <= Math.max(mediaRect.width * 2.6, mediaRect.width + 80)) {
                    return host;
                }
                if (mediaRect.width === 0) return host;
            }
        }

        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) return media;

        let host = media;
        let node = media.parentElement;

        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            const rect = node.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 40) break;

            const wRatio = rect.width / mediaRect.width;
            const hRatio = rect.height / mediaRect.height;

            if (wRatio >= 0.8 && wRatio <= 1.35 && hRatio >= 0.8 && hRatio <= 1.35) {
                host = node;
            } else {
                break;
            }
        }

        return host;
    }

    _isClippedByAncestor(media) {
        const mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) return true;

        let node = media.parentElement;
        let depth = 0;

        while (node && node !== document.body && node !== document.documentElement && depth < 15) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                if (style.overflow === 'hidden' || style.overflow === 'scroll' || style.overflow === 'auto' || 
                    style.overflowY === 'hidden' || style.overflowY === 'scroll' || style.overflowY === 'auto' ||
                    style.overflowX === 'hidden' || style.overflowX === 'scroll' || style.overflowX === 'auto') {
                    
                    const parentRect = node.getBoundingClientRect();
                    
                    const intersectLeft = Math.max(mediaRect.left, parentRect.left);
                    const intersectTop = Math.max(mediaRect.top, parentRect.top);
                    const intersectRight = Math.min(mediaRect.right, parentRect.right);
                    const intersectBottom = Math.min(mediaRect.bottom, parentRect.bottom);
                    
                    const intersectWidth = intersectRight - intersectLeft;
                    const intersectHeight = intersectBottom - intersectTop;
                    
                    if (intersectWidth <= 0 || intersectHeight <= 0) {
                        return true;
                    }
                    
                    const intersectArea = intersectWidth * intersectHeight;
                    const mediaArea = mediaRect.width * mediaRect.height;
                    
                    if (intersectArea / mediaArea < 0.4) {
                        return true;
                    }
                }
            }
            node = node.parentElement;
            depth++;
        }
        return false;
    }

    _pointInRect(x, y, rect) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    _getHoverRect(media, entry) {
        const mediaRect = media.getBoundingClientRect();
        if (!entry.hoverHost || entry.hoverHost === media) return mediaRect;
        const hostRect = entry.hoverHost.getBoundingClientRect();

        const platform = this._getPlatform();
        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;

        if (inModal) {
            if (hostRect.width >= mediaRect.width * 0.8 && hostRect.height >= mediaRect.height * 0.8) {
                return hostRect;
            }
            return mediaRect;
        }

        // Outside modal: limit host bounds to prevent swallowing sibling cards
        if (hostRect.width >= mediaRect.width * 0.8 && hostRect.width <= Math.max(mediaRect.width * 1.5, mediaRect.width + 40) &&
            hostRect.height >= mediaRect.height * 0.8 && hostRect.height <= Math.max(mediaRect.height * 1.5, mediaRect.height + 40)) {
            return hostRect;
        }
        return mediaRect;
    }

    _handlePointerMove(e) {
        const x = e.clientX;
        const y = e.clientY;

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;
        const topNavHeight = hasModal ? 0 : this._getTopNavHeight();

        // Top navigation bar guard: cursor is in the header, hide overlays
        if (y <= topNavHeight) {
            this._scheduleHide();
            return;
        }

        let hoverCandidates = [];

        // 1. Check if hovering directly over an existing button
        for (const [media, entry] of this.overlays.entries()) {
            // Modal isolation: If a modal is open, strictly ignore any media not inside the modal
            if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
                if (entry.container.style.display !== 'none') {
                    entry.container.style.display = 'none';
                    entry.container.style.visibility = 'hidden';
                }
                continue;
            }

            if (entry.container.style.display === 'none') continue;

            const btnRect = entry.container.getBoundingClientRect();
            if (btnRect.width > 0 && this._pointInRect(x, y, btnRect)) {
                this._show(entry);
                return;
            }

            // Skip if visually clipped inside a scroll container
            if (this._isClippedByAncestor(media)) continue;

            const hoverRect = this._getHoverRect(media, entry);
            if (hoverRect.width > 0 && hoverRect.height > 0 && this._pointInRect(x, y, hoverRect)) {
                hoverCandidates.push({ media, entry });
            }
        }

        if (hoverCandidates.length === 0) {
            this._scheduleHide();
            return;
        }

        // 2. Use document.elementsFromPoint to ensure we only trigger elements that the user is actually hovering
        const hits = document.elementsFromPoint(x, y);
        if (!hits || hits.length === 0) {
            this._scheduleHide();
            return;
        }

        let matchedCandidates = [];

        for (const candidate of hoverCandidates) {
            const entry = candidate.entry;
            const media = candidate.media;
            const mRect = media.getBoundingClientRect();
            const hRect = entry.hoverHost ? entry.hoverHost.getBoundingClientRect() : mRect;

            const inMedia = this._pointInRect(x, y, mRect);
            const inHost = this._pointInRect(x, y, hRect);

            if (inMedia || inHost) {
                const belongs = hits.some(el => {
                    if (el === media || media.contains(el)) return true;
                    if (entry.hoverHost && (el === entry.hoverHost || entry.hoverHost.contains(el))) return true;
                    const card = media.closest('a[href*="/reel"], a[href*="/reels"], div[data-pagelet*="Reel"], div[role="article"], div[role="listitem"]');
                    if (card && (el === card || card.contains(el))) return true;
                    return false;
                });
                if (belongs && !matchedCandidates.includes(candidate)) {
                    matchedCandidates.push(candidate);
                }
            }
        }

        if (matchedCandidates.length > 0) {
            // Find candidate that directly contains the cursor (so sibling cards in carousels never steal hover)
            let best = null;
            for (const c of matchedCandidates) {
                const mr = c.media.getBoundingClientRect();
                if (this._pointInRect(x, y, mr)) {
                    if (!best || (c.media.tagName.toLowerCase() === 'video' && best.media.tagName.toLowerCase() !== 'video')) {
                        best = c;
                    }
                }
            }
            if (!best) {
                best = matchedCandidates[0];
            }
            this._show(best.entry);
            return;
        }

        // If no candidate was actually hit by elementsFromPoint (e.g. hovering on dialog background / comments),
        // hide any active overlay rather than guessing incorrectly.
        this._scheduleHide();
    }

    _show(entry) {
        clearTimeout(this.hideTimeout);
        if (this.activeEntry && this.activeEntry !== entry) {
            this._hide(this.activeEntry);
        }
        entry.container.style.display = 'flex';
        entry.container.style.opacity = '1';
        entry.container.style.visibility = 'visible';
        entry.container.style.pointerEvents = 'auto';
        this.activeEntry = entry;
    }

    _hide(entry) {
        if (!entry || !entry.container) return;
        entry.container.style.opacity = '0';
        entry.container.style.visibility = 'hidden';
        entry.container.style.pointerEvents = 'none';
    }

    _scheduleHide() {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => {
            for (const entry of this.overlays.values()) {
                this._hide(entry);
            }
            this.activeEntry = null;
        }, 250);
    }

    addOverlay(media, createButtonsFn) {
        if (this.overlays.has(media)) return;

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;
        if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'magic-dl-overlay';
        container.style.cssText = `
            position: fixed;
            z-index: 2147483646;
            display: flex;
            gap: 6px;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease, visibility 0.15s ease;
        `;

        const buttons = createButtonsFn();
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', () => this._show(this.overlays.get(media)));
            container.appendChild(btn);
        });

        document.body.appendChild(container);

        const hoverHost = this._findHoverHost(media);
        const hostShow = () => {
            const entry = this.overlays.get(media);
            if (entry) {
                const curPlatform = this._getPlatform();
                const curModal = curPlatform && curPlatform.hasActiveModal ? curPlatform.hasActiveModal() : false;
                if (curModal && curPlatform && curPlatform.isInsideModal && !curPlatform.isInsideModal(media)) {
                    return;
                }
                this._show(entry);
            }
        };
        const hostHide = () => this._scheduleHide();

        hoverHost.addEventListener('mouseenter', hostShow, true);
        hoverHost.addEventListener('mouseleave', hostHide, true);
        hoverHost.addEventListener('pointerenter', hostShow, true);
        hoverHost.addEventListener('pointerleave', hostHide, true);

        const resizeObserver = new ResizeObserver(() => {
            this.updatePosition(media, container);
        });
        resizeObserver.observe(media);
        if (hoverHost !== media) {
            resizeObserver.observe(hoverHost);
        }

        const entry = { container, corner: null, resizeObserver, hoverHost, isVisible: false, intersectionObserver: null };
        
        entry.intersectionObserver = new IntersectionObserver((entries) => {
            for (const e of entries) {
                entry.isVisible = e.isIntersecting;
                this.updatePosition(media, container);
            }
        }, { threshold: 0.15 });
        
        entry.intersectionObserver.observe(media);

        this.overlays.set(media, entry);

        requestAnimationFrame(() => this.updatePosition(media, container));
    }

    isSiteControl(el, media) {
        if (!el || el === document.documentElement || el === document.body) return false;
        if (el.closest('.magic-dl-overlay')) return false;
        if (el === media || media.contains(el)) return false;

        const entry = this.overlays.get(media);
        if (entry && (el === entry.hoverHost || entry.hoverHost.contains(el))) return false;

        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const className = (el.className && typeof el.className === 'string')
            ? el.className.toLowerCase()
            : '';

        const controlHints = ['close', 'dismiss', 'minimize', 'expand', 'fullscreen', 'menu', 'more', 'options', 'share',
                               'mute', 'unmute', 'volume', 'sound', 'play', 'pause', 'like', 'comment', 'follow',
                               'audio', 'speaker', 'forward', 'rewind', 'skip', 'next', 'previous', 'seek'];
        const hintText = `${ariaLabel} ${title} ${className}`;
        if (controlHints.some(hint => hintText.includes(hint))) return true;

        if (['button', 'input', 'select', 'textarea'].includes(tag)) return true;
        if (role === 'button' || role === 'menuitem') return true;
        if (el.closest('button, [role="button"], [role="menuitem"]')) return true;

        const style = window.getComputedStyle(el);
        if (style.pointerEvents !== 'none' && parseInt(style.zIndex, 10) > 5000) return true;

        return false;
    }

    getPlatformConfig(media) {
        const platform = this._getPlatform();
        if (platform && platform.getPlatformConfig) {
            return platform.getPlatformConfig(window.location.pathname.toLowerCase(), media);
        }
        return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
    }

    cornerHasConflict(media, rect, corner, width, height, pad = 12) {
        const config = this.getPlatformConfig(media);
        const topOffset = config.topOffset || 0;
        let x;
        let y;

        switch (corner) {
            case 'bottom-right':
                x = rect.right - pad - width / 2;
                y = rect.bottom - pad - height / 2;
                break;
            case 'bottom-left':
                x = rect.left + pad + width / 2;
                y = rect.bottom - pad - height / 2;
                break;
            case 'top-left':
                x = rect.left + pad + width / 2;
                y = rect.top + pad + topOffset + height / 2;
                break;
            case 'top-right':
                x = rect.right - pad - width / 2;
                y = rect.top + pad + topOffset + height / 2;
                break;
            case 'top-center':
                x = rect.left + rect.width / 2;
                y = rect.top + pad + topOffset + height / 2;
                break;
            case 'bottom-center':
                x = rect.left + rect.width / 2;
                y = rect.bottom - pad - height / 2;
                break;
            default:
                return true;
        }

        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
            return true;
        }

        const hits = document.elementsFromPoint(x, y);
        for (const el of hits) {
            if (this.isSiteControl(el, media)) return true;
        }
        return false;
    }

    pickBestCorner(media, rect, container) {
        const width = container.offsetWidth || 80;
        const height = container.offsetHeight || 36;
        const config = this.getPlatformConfig(media);

        const corners = [...config.preferredCorners];

        for (const corner of corners) {
            if (!this.cornerHasConflict(media, rect, corner, width, height, config.padding)) {
                return corner;
            }
        }

        return corners[0] || 'top-left';
    }

    // Compute the actually visible portion of a media element by intersecting
    // its rect with all overflow-clipping ancestors and the viewport.
    _getVisibleRect(media) {
        let vRect = media.getBoundingClientRect();
        let visTop = vRect.top;
        let visLeft = vRect.left;
        let visBottom = vRect.bottom;
        let visRight = vRect.right;

        let node = media.parentElement;
        let depth = 0;
        while (node && node !== document.body && node !== document.documentElement && depth < 15) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node);
                const ov = style.overflow + style.overflowX + style.overflowY;
                if (ov.includes('hidden') || ov.includes('scroll') || ov.includes('auto') || ov.includes('clip')) {
                    const pRect = node.getBoundingClientRect();
                    visTop = Math.max(visTop, pRect.top);
                    visLeft = Math.max(visLeft, pRect.left);
                    visBottom = Math.min(visBottom, pRect.bottom);
                    visRight = Math.min(visRight, pRect.right);
                }
            }
            node = node.parentElement;
            depth++;
        }

        const platform = this._getPlatform();
        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const topLimit = inModal ? 0 : this._getTopNavHeight();

        // Also clamp to viewport & sticky top nav
        visTop = Math.max(visTop, topLimit);
        visLeft = Math.max(visLeft, 0);
        visBottom = Math.min(visBottom, window.innerHeight);
        visRight = Math.min(visRight, window.innerWidth);

        return {
            top: visTop,
            left: visLeft,
            bottom: visBottom,
            right: visRight,
            width: Math.max(0, visRight - visLeft),
            height: Math.max(0, visBottom - visTop)
        };
    }

    applyCornerPosition(rect, container, corner, media) {
        const config = this.getPlatformConfig(media);
        const pad = config.padding;
        const topOffset = config.topOffset || 0;
        const width = container.offsetWidth || 80;
        const height = container.offsetHeight || 36;

        let top, left;

        switch (corner) {
            case 'bottom-right':
                top = rect.bottom - height - pad;
                left = rect.right - width - pad;
                break;
            case 'bottom-left':
                top = rect.bottom - height - pad;
                left = rect.left + pad;
                break;
            case 'top-left':
                top = rect.top + pad + topOffset;
                left = rect.left + pad;
                break;
            case 'top-right':
                top = rect.top + pad + topOffset;
                left = rect.right - width - pad;
                break;
            case 'top-center':
                top = rect.top + pad + topOffset;
                left = rect.left + (rect.width - width) / 2;
                break;
            case 'bottom-center':
                top = rect.bottom - height - pad;
                left = rect.left + (rect.width - width) / 2;
                break;
            default:
                top = rect.top + pad + topOffset;
                left = rect.left + pad;
        }

        const platform = this._getPlatform();
        const section = platform && platform.getSection ? platform.getSection() : 'feed';
        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const isReel = section === 'reels' || (config.preferredCorners && config.preferredCorners[0] === 'top-right' && config.topOffset);
        const isImmersive = inModal || isReel || section === 'stories';
        const topNavHeight = isImmersive ? 0 : this._getTopNavHeight();

        // 1. Strict Top Boundary:
        // As media scrolls, keep button locked in place! When its corner reaches the top navbar,
        // HIDE it gracefully — NEVER dynamically jump down to bottom-right!
        if (!isImmersive) {
            if (top < topNavHeight + 4) {
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                return;
            }
        } else {
            if (top < 4) {
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                return;
            }
        }

        // 2. Viewport Boundaries:
        if (top + height > window.innerHeight - 4 || left < 2 || left + width > window.innerWidth - 2) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        // 3. Overflow container / ancestor clipping:
        const vis = media ? this._getVisibleRect(media) : rect;
        if (top < vis.top - 2 || top + height > vis.bottom + 2 || left < vis.left - 2 || left + width > vis.right + 2) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        container.style.top = `${top}px`;
        container.style.left = `${left}px`;
    }

    updatePosition(media, container) {
        const entry = this.overlays.get(media);
        if (!entry) return;

        if (!media.isConnected) {
            entry.resizeObserver.disconnect();
            if (entry.intersectionObserver) entry.intersectionObserver.disconnect();
            container.remove();
            if (this.activeEntry === entry) this.activeEntry = null;
            this.overlays.delete(media);
            return;
        }

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

        // Modal isolation check
        if (hasModal && platform && platform.isInsideModal && !platform.isInsideModal(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        // Per-section toggle check
        if (this._isSectionDisabledByToggle()) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        // Section thumbnail/eligibility check
        if (platform && platform.isThumbnail && platform.isThumbnail(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        const rect = media.getBoundingClientRect();
        const style = window.getComputedStyle(media);
        const isStyleHidden = style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none';

        const inModal = platform && platform.isInsideModal ? platform.isInsideModal(media) : false;
        const topNavHeight = inModal ? 0 : this._getTopNavHeight();

        // If media has scrolled behind top navbar or off screen
        if (rect.bottom <= topNavHeight + 8) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        const vis = this._getVisibleRect(media);
        if (vis.height < 45 || vis.width < 50) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            if (this.activeEntry === entry) this.activeEntry = null;
            return;
        }

        if (rect.width === 0 || rect.height === 0 || !entry.isVisible || isStyleHidden || this._isClippedByAncestor(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            return;
        }

        const fullyAbove = rect.bottom < 0;
        const fullyBelow = rect.top > window.innerHeight;
        const fullyLeft = rect.right < 0;
        const fullyRight = rect.left > window.innerWidth;

        if (fullyAbove || fullyBelow || fullyLeft || fullyRight) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.pointerEvents = 'none';
            return;
        }

        container.style.display = 'flex';
        if (this.activeEntry === entry) {
            container.style.visibility = 'visible';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }

        // Lock corner on first placement so buttons never jump down across corners on scroll!
        if (!entry.corner) {
            entry.corner = this.pickBestCorner(media, rect, container);
        }
        this.applyCornerPosition(rect, container, entry.corner, media);
    }

    updateAllPositions() {
        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

        // If an active modal is open and the activeEntry is outside the modal, instantly reset it
        if (hasModal && this.activeEntry && platform && platform.isInsideModal && !platform.isInsideModal(this.activeEntry.hoverHost)) {
            this._hide(this.activeEntry);
            this.activeEntry = null;
        }

        for (const [media, entry] of this.overlays.entries()) {
            this.updatePosition(media, entry.container);
        }
    }
}

window.magicOverlayManager = new OverlayManager();
