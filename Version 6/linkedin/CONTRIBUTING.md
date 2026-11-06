# 🤝 Toystaller Technical Specification, Architecture & Contributing Guide

> **Main Global Multi-Platform Repository:** [https://github.com/SudiptaSanki/Toystaller](https://github.com/SudiptaSanki/Toystaller)  
> **LinkedIn Specialized Repository:** [https://github.com/SudiptaSanki/Toystaller-LinkedIn](https://github.com/SudiptaSanki/Toystaller-LinkedIn)  
> **Version:** 1.0 (Specialized Edition)  
> **Specification Target:** Chromium Manifest V3

---

## 📑 Table of Contents
1. [Executive Summary & Motivation](#1-executive-summary--motivation)
2. [Why Standard Media Downloaders Fail on LinkedIn](#2-why-standard-media-downloaders-fail-on-linkedin)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Component Deep Dive](#4-component-deep-dive)
   - [4.1 Main World Execution & Page Interceptor](#41-main-world-execution--page-interceptor)
   - [4.2 DOM & React Fiber State Inspection Engine](#42-dom--react-fiber-state-inspection-engine)
   - [4.3 Dynamic Network Interception Pipeline](#43-dynamic-network-interception-pipeline)
   - [4.4 Anti-Redirect In-Browser HTML5 Player](#44-anti-redirect-in-browser-html5-player)
   - [4.5 DeclarativeNetRequest Header Injection](#45-declarativenetrequest-header-injection)
   - [4.6 Overlay Manager & Corner-Locking Stability Engine](#46-overlay-manager--corner-locking-stability-engine)
   - [4.7 Modal Isolation & Zero-Bleed Backdrop Engine](#47-modal-isolation--zero-bleed-backdrop-engine)
   - [4.8 LinkedIn CDN URL Upgrading](#48-linkedin-cdn-url-upgrading)
   - [4.9 Background Service Worker & Download Pipeline](#49-background-service-worker--download-pipeline)
5. [LinkedIn Section-by-Section Handler Matrix](#5-linkedin-section-by-section-handler-matrix)
6. [Performance, Memory & Lifecycle Optimization](#6-performance-memory--lifecycle-optimization)
7. [Security, Sandboxing & Privacy Guarantees](#7-security-sandboxing--privacy-guarantees)
8. [Comparison with Alternative Approaches](#8-comparison-with-alternative-approaches)
9. [Development, Building & Contributing](#9-development-building--contributing)

---

## 1. Executive Summary & Motivation

**Toystaller: LinkedIn Edition** was created to solve a fundamental problem in the modern web: **access to original, uncompressed user media**. Social media networks such as LinkedIn employ client-side rendering engines, dynamic adaptive streaming (DASH/HLS), and segmented blob streams (`blob:https://...`) to obscure direct media sources.

Traditional approaches either require third-party web scrapers loaded with ads or scrape low-resolution preview URLs from the DOM. **Toystaller operates entirely within the client's browser**, non-destructively reading memory states and network buffers that the official LinkedIn web client has already authenticated and decrypted.

---

## 2. Why Standard Media Downloaders Fail on LinkedIn

LinkedIn's web client implements multiple anti-scraping and optimization layers:

```
[User Browser]
   ├── 1. Blob URLs: <video src="blob:https://linkedin.com/xyz...">
   │      └── Direct download returns 0-byte or corrupted stream.
   ├── 2. DASH Segmentation: Video streams are split via DASH manifests (.mpd).
   ├── 3. Custom DOM Overlay Layers: Transparent divs layer over <video>,
   │      intercepting all right-click and context menu events.
   ├── 4. CDN 403 / 302 Restrictions: Direct navigation to CDN video URLs in a browser tab
   │      triggers HTTP 302 redirects back to the login page or HTTP 403 Forbidden.
   └── 5. Single-Page Navigation (SPA): Posts opened from feed render
          as modals without a full page reload, leaving background media active.
```

Toystaller bypasses all five barriers directly at the browser runtime level without modifying LinkedIn's original DOM or triggering anti-bot heuristics.

---

## 3. System Architecture Overview

```
+-----------------------------------------------------------------------------------+
| CHROMIUM BROWSER RUNTIME                                                          |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | MAIN WORLD (Page Context - window)                                         |  |
|  |                                                                             |  |
|  |   [ LinkedIn Web Application ]                                             |  |
|  |      │                                                                      |  |
|  |      ├─── DOM data-sources Attribute (video progressive URLs)              |  |
|  |      ├─── React Fiber Tree (__reactFiber$, __reactProps$)                   |  |
|  |      │       ▲                                                              |  |
|  |      │       │ [Deep Object Traversal Engine]                               |  |
|  |      │   [ page_interceptor.js + platforms/linkedin.js ]                    |  |
|  |      │       ▲                                                              |  |
|  |      └─── Network Hooks (window.fetch, window.XMLHttpRequest)               |  |
|  |              │                                                              |  |
|  |              ▼ window.postMessage                                           |  |
|  +--------------┼--------------------------------------------------------------+  |
|                 │                                                                 |
|  +--------------┼--------------------------------------------------------------+  |
|  | ISOLATED CONTENT SCRIPT WORLD                                               |  |
|  |              ▼                                                              |  |
|  |   [ content_script.js ] ◄───► [ platforms/linkedin.js ]                     |  |
|  |          │                                                                  |  |
|  |          ▼                                                                  |  |
|  |   [ overlay_manager.js ]                                                     |  |
|  |      ├── MutationObserver (Modal Dialog Detection)                          |  |
|  |      ├── IntersectionObserver (Media Viewport Tracking)                     |  |
|  |      ├── ResizeObserver (Dynamic Element Relocation)                        |  |
|  |      └── elementsFromPoint (Occlusion & Hover Hit Testing)                  |  |
|  |              │                                                              |  |
|  |              ▼ chrome.runtime.sendMessage                                   |  |
|  +--------------┼--------------------------------------------------------------+  |
|                 │                                                                 |
|  +--------------┼--------------------------------------------------------------+  |
|  | BACKGROUND SERVICE WORKER                                                   |  |
|  |              ▼                                                              |  |
|  |   [ background_script.js ]                                                  |  |
|  |      ├── chrome.downloads.download() ───► [ Local File System ]             |  |
|  |      ├── player.html & player.js     ───► [ Anti-Redirect In-Browser Player ] |
|  |      ├── chrome.tabs.create()         ───► [ High-Res Image Tab ]           |  |
|  |      └── declarativeNetRequest        ───► [ rules.json Referer Rewrite ]   |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Component Deep Dive

### 4.1 Main World Execution & Page Interceptor
Chrome extension content scripts run by default in an **Isolated World**. Toystaller dynamically injects `platforms/linkedin.js` and `page_interceptor.js` directly into the **MAIN world** using script tag injection at `document_start`.

### 4.2 DOM & React Fiber State Inspection Engine
Extracts progressive MP4 streams with bitrate selection from `<video data-sources="...">` and traverses React Fiber instances (`__reactFiber$`, `__reactProps$`) up to 12 levels to extract high-resolution media URLs.

### 4.3 Dynamic Network Interception Pipeline
`page_interceptor.js` monitors network traffic and Voyager API calls (`/voyager/api/`), capturing valid media URLs into memory.

### 4.4 Anti-Redirect In-Browser HTML5 Player
Routes video streams to `player.html`, bypassing CDN top-level document 302 redirects with client-side `<video>` element requests.

### 4.5 DeclarativeNetRequest Header Injection
Rules in `rules.json` inject official `Referer: https://www.linkedin.com/` and `Origin: https://www.linkedin.com` headers into requests directed to `licdn.com` and `linkedin.com`.

### 4.6 Overlay Manager & Corner-Locking Stability Engine
Permanently locks corners once determined for an element; hides overlays gracefully behind `#global-nav` on scroll; provides per-section toggles from `popup.html`.

### 4.7 Modal Isolation & Zero-Bleed Backdrop Engine
Isolates modal dialogs (`.artdeco-modal`) so buttons only appear on the active dialog.

### 4.8 LinkedIn CDN URL Upgrading
Upgrades `/100/`, `/200/`, `/400/`, `/800/` to `/1000/` on `media.licdn.com/dms/image`.

### 4.9 Background Service Worker & Download Pipeline
Handles file saving via `chrome.downloads.download({ url, filename, saveAs: true })` and tab management.

---

## 5. LinkedIn Section-by-Section Handler Matrix

| Section | Detection Rule | Target Strategy | Filter Strategy |
| :--- | :--- | :--- | :--- |
| **Modal Dialog** | `.artdeco-modal, [role="dialog"]` (size > 400×400) | Modal-contained media only | Rejects all background feed items |
| **Feed** | `/feed/` | Post images (`naturalW ≥ 200`), native videos | Rejects circular profile pictures (`border-radius: 50%`), icons `< 100px` |
| **Articles** | `/pulse/`, `/article/` | Embedded images, slides, video streams | Filters out author thumbnails and nav icons |
| **Profile** | `/in/<username>/` | Profile photo, banner, shared media | Rejects small UI icons and connection avatars |
| **Messaging** | `/messaging/` | Chat media attachments | Rejects conversation participant avatars |
| **General** | Any other LinkedIn page | Images ≥ 200×200, all video elements | Rejects thumbnails `< 100px`, circular avatars |

---

## 6. Performance, Memory & Lifecycle Optimization

- **Throttled Pointer Events**: Mousemove handlers are throttled to 30ms intervals.
- **Garbage Collection Safety**: Observers and overlay containers are disconnected and cleaned up when elements are removed.
- **Context Invalidation Protection**: Messaging calls use `safeSendMessage` try-catch blocks.

---

## 7. Security, Sandboxing & Privacy Guarantees

1. **Zero External Communication**: All traffic stays within official LinkedIn CDNs.
2. **Read-Only Inspection**: Inspects memory states without modifying session tokens or cookies.
3. **Shadow DOM Isolation**: Settings dashboard runs in a closed ShadowRoot.

---

## 8. Comparison with Alternative Approaches

| Feature / Metric | Toystaller for LinkedIn | Generic Web Scraper / Web Tools | DOM Video Scraping Extensions |
| :--- | :--- | :--- | :--- |
| **Video Quality** | **Progressive MP4 / Highest Bitrate** | Often capped at low quality | Capped at compressed blob preview |
| **In-Browser Player** | **Built-in Dark HTML5 Player (302 Bypass)** | None (redirect loops) | None |
| **Image Resolution** | **Maximum CDN Resolution (auto-upgraded)** | Compressed JPEG | Screen-size cropped preview |
| **Account Safety** | **100% Safe (Local client-side)** | High risk (Requires login/cookies) | Safe |
| **Speed** | **Instant (0 ms network overhead)** | Slow (Server processing time) | Instant |
| **Advertisements / Trackers** | **None (Zero)** | Heavy Adware / Popups | Minimal |
| **Private Content Support** | **Yes (If visible in your feed)** | No | Limited |

---

## 9. Development, Building & Contributing

### Repository Structure
- **Root (`/`)**: Load directly unpacked in Chrome (`chrome://extensions/` -> Load unpacked -> select `Toystaller-LinkedIn` directory).

### How to Contribute
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

<div align="center">
<b>Toystaller Contributing Guide</b> • Maintained by <a href="https://github.com/SudiptaSanki">Sudipta Sanki</a>
</div>
