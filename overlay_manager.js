// overlay_manager.js
// Tracks media elements and positions action buttons safely on document.body.
// v2: smart corner placement + reliable hover via cursor bounds (works when
// sites layer invisible divs over <video> and block mouseenter on the tag).

class OverlayManager {
    constructor() {
        this.overlays = new Map();
        this.activeEntry = null;
        this.hideTimeout = null;

        this._onMouseMove = this._throttle(this._handlePointerMove.bind(this), 40);
        document.addEventListener('mousemove', this._onMouseMove, true);
        document.addEventListener('pointermove', this._onMouseMove, true);

        window.addEventListener('scroll', () => this.updateAllPositions(), true);
        window.addEventListener('resize', () => this.updateAllPositions());

        setInterval(() => this.updateAllPositions(), 1000);
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
                    
                    // Calculate intersection area
                    const intersectLeft = Math.max(mediaRect.left, parentRect.left);
                    const intersectTop = Math.max(mediaRect.top, parentRect.top);
                    const intersectRight = Math.min(mediaRect.right, parentRect.right);
                    const intersectBottom = Math.min(mediaRect.bottom, parentRect.bottom);
                    
                    const intersectWidth = intersectRight - intersectLeft;
                    const intersectHeight = intersectBottom - intersectTop;
                    
                    // If no intersection at all, it's fully clipped
                    if (intersectWidth <= 0 || intersectHeight <= 0) {
                        return true;
                    }
                    
                    // If less than 40% of the media area is visible inside the parent, treat it as clipped
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

        let hoverCandidates = [];

        // 1. Check if hovering directly over an existing button
        for (const [media, entry] of this.overlays.entries()) {
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

        if (hoverCandidates.length === 1) {
            this._show(hoverCandidates[0].entry);
            return;
        }

        // 2. Multiple overlapping media elements. Find the topmost one using native z-index/stacking!
        const hits = document.elementsFromPoint(x, y);
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

        // Fallback: If elementsFromPoint failed to match (e.g. full-screen transparent interceptor div),
        // we assume the most recently added overlay (last in the Map) is the topmost (like a modal).
        this._show(hoverCandidates[hoverCandidates.length - 1].entry);
    }

    _show(entry) {
        clearTimeout(this.hideTimeout);
        if (this.activeEntry && this.activeEntry !== entry) {
            this._hide(this.activeEntry);
        }
        entry.container.style.opacity = '1';
        entry.container.style.visibility = 'visible';
        this.activeEntry = entry;
    }

    _hide(entry) {
        entry.container.style.opacity = '0';
    }

    _scheduleHide() {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => {
            for (const entry of this.overlays.values()) {
                this._hide(entry);
            }
            this.activeEntry = null;
        }, 300);
    }

    addOverlay(media, createButtonsFn) {
        if (this.overlays.has(media)) return;

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
            if (entry) this._show(entry);
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
        }, { threshold: 0.15 }); // Require at least 15% visibility
        
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

        const controlHints = ['close', 'dismiss', 'minimize', 'expand', 'fullscreen', 'menu', 'more', 'options', 'share'];
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
        const host = window.location.hostname.toLowerCase();
        const path = window.location.pathname.toLowerCase();
        
        if (host.includes('instagram.com')) {
            if (path.includes('/direct/')) {
                return { preferredCorners: ['bottom-left', 'top-left'], padding: 12 };
            }
            if (path.includes('/reels/') || path.includes('/reel/')) {
                return { preferredCorners: ['top-left', 'bottom-left'], padding: 12 };
            }
            return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
        }
        
        if (host.includes('linkedin.com')) {
            return { preferredCorners: ['top-left', 'bottom-left', 'top-right'], padding: 12 };
        }
        
        return { preferredCorners: ['bottom-right', 'bottom-left', 'top-left'], padding: 10 };
    }

    cornerHasConflict(media, rect, corner, width, height, pad = 12) {
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
                y = rect.top + pad + height / 2;
                break;
            case 'top-right':
                x = rect.right - pad - width / 2;
                y = rect.top + pad + height / 2;
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

        // For non-social platforms, if media is near the top-right viewport edge,
        // prioritize bottom-left to avoid clashing with close icons.
        const host = window.location.hostname.toLowerCase();
        if (!host.includes('instagram.com') && !host.includes('linkedin.com')) {
            const nearTop = rect.top < 72;
            const nearRight = rect.right > window.innerWidth - 72;
            if (nearTop && nearRight) {
                const idx = corners.indexOf('bottom-left');
                if (idx > -1) {
                    corners.splice(idx, 1);
                    corners.unshift('bottom-left');
                }
            }
        }

        for (const corner of corners) {
            if (!this.cornerHasConflict(media, rect, corner, width, height, config.padding)) {
                return corner;
            }
        }

        return corners[0] || 'bottom-right';
    }

    applyCornerPosition(rect, container, corner) {
        const config = this.getPlatformConfig();
        const pad = config.padding;
        const width = container.offsetWidth || 80;
        const height = container.offsetHeight || 36;

        switch (corner) {
            case 'bottom-right':
                container.style.top = `${rect.bottom - height - pad}px`;
                container.style.left = `${rect.right - width - pad}px`;
                break;
            case 'bottom-left':
                container.style.top = `${rect.bottom - height - pad}px`;
                container.style.left = `${rect.left + pad}px`;
                break;
            case 'top-left':
                container.style.top = `${rect.top + pad}px`;
                container.style.left = `${rect.left + pad}px`;
                break;
            case 'top-right':
                container.style.top = `${rect.top + pad}px`;
                container.style.left = `${rect.right - width - pad}px`;
                break;
            default:
                container.style.top = `${rect.bottom - height - pad}px`;
                container.style.left = `${rect.right - width - pad}px`;
        }
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

        const rect = media.getBoundingClientRect();
        
        const style = window.getComputedStyle(media);
        const isStyleHidden = style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none';

        if (rect.width === 0 || rect.height === 0 || !entry.isVisible || isStyleHidden || this._isClippedByAncestor(media)) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        const fullyAbove = rect.bottom < 0;
        const fullyBelow = rect.top > window.innerHeight;
        const fullyLeft = rect.right < 0;
        const fullyRight = rect.left > window.innerWidth;

        if (fullyAbove || fullyBelow || fullyLeft || fullyRight) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            return;
        }

        container.style.display = 'flex';
        if (this.activeEntry === entry) {
            container.style.visibility = 'visible';
        }

        const corner = this.pickBestCorner(media, rect, container);
        entry.corner = corner;
        this.applyCornerPosition(rect, container, corner);
    }

    updateAllPositions() {
        for (const [media, entry] of this.overlays.entries()) {
            this.updatePosition(media, entry.container);
        }
    }
}

window.magicOverlayManager = new OverlayManager();
