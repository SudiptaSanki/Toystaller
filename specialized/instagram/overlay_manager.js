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
            toystaller_show_grid:    true,
            toystaller_show_feed:    true,
            toystaller_show_stories: true,
            toystaller_show_dm:      true
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

        window.addEventListener('scroll', () => this.updateAllPositions(), true);
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

        // Reels, modals, and standalone posts are ALWAYS enabled (never toggled off)
        if (section === 'reels' || section === 'modal' || section === 'post_standalone') return false;

        // Map sections to toggle keys
        if (section === 'feed')    return !this._sectionToggles.toystaller_show_feed;
        if (section === 'stories') return !this._sectionToggles.toystaller_show_stories;
        if (section === 'direct')  return !this._sectionToggles.toystaller_show_dm;

        // All profile grid sections and explore → grid toggle
        if (section.startsWith('profile_') || section === 'explore') {
            return !this._sectionToggles.toystaller_show_grid;
        }

        return false;
    }

    _getPlatform() {
        if (typeof PlatformManager !== 'undefined') {
            return PlatformManager.getPlatform();
        }
        if (window.ToystallerActivePlatform) {
            return window.ToystallerActivePlatform;
        }
        if (window.ToystallerPlatforms && window.ToystallerPlatforms['instagram']) {
            return window.ToystallerPlatforms['instagram'];
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
        const hostRect = entry.hoverHost.getBoundingClientRect();

        if (hostRect.width >= mediaRect.width * 0.8 && hostRect.height >= mediaRect.height * 0.8) {
            return hostRect;
        }
        return mediaRect;
    }

    _handlePointerMove(e) {
        const x = e.clientX;
        const y = e.clientY;

        const platform = this._getPlatform();
        const hasModal = platform && platform.hasActiveModal ? platform.hasActiveModal() : false;

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

        for (const el of hits) {
            for (const candidate of hoverCandidates) {
                const entry = candidate.entry;
                const media = candidate.media;
                if (el === entry.hoverHost || entry.hoverHost.contains(el) || el === media || media.contains(el)) {
                    if (!matchedCandidates.includes(candidate)) {
                        matchedCandidates.push(candidate);
                    }
                }
            }
        }

        if (matchedCandidates.length > 0) {
            // Prioritize <video> tags over <img> tags (e.g. poster images covering the video)
            const videoCandidate = matchedCandidates.find(c => c.media.tagName.toLowerCase() === 'video');
            if (videoCandidate) {
                this._show(videoCandidate.entry);
            } else {
                this._show(matchedCandidates[0].entry);
            }
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

    getPlatformConfig() {
        const platform = this._getPlatform();
        if (platform && platform.getPlatformConfig) {
            return platform.getPlatformConfig(window.location.pathname.toLowerCase());
        }
        return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
    }

    cornerHasConflict(media, rect, corner, width, height, pad = 12) {
        const config = this.getPlatformConfig();
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
        const config = this.getPlatformConfig();

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

        // Also clamp to viewport
        visTop = Math.max(visTop, 0);
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
        const config = this.getPlatformConfig();
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
            default:
                top = rect.top + pad + topOffset;
                left = rect.left + pad;
        }

        // Compute the VISIBLE portion of the media (accounts for sticky headers,
        // overflow-hidden ancestors, and viewport edges)
        const vis = media ? this._getVisibleRect(media) : rect;

        // CLAMP: Ensure buttons stay INSIDE the VISIBLE media frame
        const minTop = vis.top + 2;
        const maxTop = vis.bottom - height - 2;
        const minLeft = vis.left + 2;
        const maxLeft = vis.right - width - 2;

        top = Math.max(minTop, Math.min(top, maxTop));
        left = Math.max(minLeft, Math.min(left, maxLeft));

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

        const corner = this.pickBestCorner(media, rect, container);
        entry.corner = corner;
        this.applyCornerPosition(rect, container, corner, media);
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
