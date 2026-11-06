# 🤝 Contributing to Toystaller: WhatsApp Edition

> **Repository:** [https://github.com/SudiptaSanki/Toystaller-WhatsApp](https://github.com/SudiptaSanki/Toystaller-WhatsApp)  
> **Target Platform:** WhatsApp Web (`web.whatsapp.com`)  
> **Version:** 1.0 (Specialized Edition)  
> **Specification:** Chromium Manifest V3

---

## 📑 Table of Contents
1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started & Local Setup](#2-getting-started--local-setup)
3. [Repository Architecture](#3-repository-architecture)
4. [Development Guidelines](#4-development-guidelines)
5. [Testing & Verification](#5-testing--verification)
6. [Submitting Pull Requests](#6-submitting-pull-requests)

---

## 1. Code of Conduct

Please maintain a welcoming, inclusive, and professional environment. Focus on constructive feedback, technical excellence, and user privacy.

---

## 2. Getting Started & Local Setup

### Prerequisites
- Any modern Chromium browser (Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi).
- [Node.js](https://nodejs.org/) (for syntax verification: `node -c`).
- Git.

### Clone the Repository
```bash
git clone https://github.com/SudiptaSanki/Toystaller-WhatsApp.git
cd Toystaller-WhatsApp
```

### Loading in Browser
1. Open `chrome://extensions/` in your Chromium browser.
2. Toggle **Developer mode** to **ON** (top right).
3. Click **Load unpacked** and select:
   - The repository root folder `Toystaller-WhatsApp/`, **OR**
   - The self-contained `whatsapp/` package subdirectory.
4. Open [WhatsApp Web](https://web.whatsapp.com/) and test.

---

## 3. Repository Architecture

```text
Toystaller-WhatsApp/
├── manifest.json            # Extension manifest (MV3)
├── background_script.js     # Background Service Worker & player tab dispatcher
├── content_script.js        # Content script orchestrator
├── overlay_manager.js       # Permanently locked corner overlay manager
├── page_interceptor.js      # Main-world Fetch/XHR interceptor & React Fiber reader
├── player.html              # Dedicated HTML5 in-browser video player
├── player.js                # Player controller (playback, download, copy link)
├── rules.json               # DeclarativeNetRequest header rules for *.whatsapp.net
├── popup.html               # Popup settings panel UI (v1.0 Specialized Edition)
├── popup.js                 # Popup settings logic & tab synchronization
├── Toystaller_logo.png      # Extension icon
├── platforms/
│   └── whatsapp.js          # Dedicated WhatsApp section detector & extractors
├── core/                    # Shared modular core architecture
│   ├── background_core.js
│   ├── content_core.js
│   ├── interceptor_core.js
│   └── overlay_manager.js
├── whatsapp/                # Self-contained standalone WhatsApp package
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── platform.js
│   ├── player.html
│   ├── player.js
│   ├── rules.json
│   ├── popup.html
│   ├── popup.js
│   ├── icon.png
│   └── core/
├── DETAILS.md               # Technical specification & architecture guide
├── CONTRIBUTING.md          # Contributing guidelines
├── LICENSE                  # MIT License
└── README.md                # Project documentation & installation manual
```

---

## 4. Development Guidelines

1. **Zero External Dependencies**:
   - Do NOT add npm packages or third-party bundle tools. Toystaller runs on pure vanilla modern JavaScript (ES2022+).
2. **Dual-Folder Synchronization**:
   - Any modifications to core logic, manifests, player files, or overlay managers **must be kept synchronized** between the root extension files and the `whatsapp/` package directory.
3. **Corner Stability**:
   - Maintain permanently locked corners per media element. Once `entry.corner` is selected via `pickBestCorner`, it must remain fixed. Do not re-evaluate corners on scroll.
4. **Header Clearance**:
   - Media scrolling under sticky headers (`top < topNavHeight + 4`) must cleanly hide (`display: 'none'; visibility: 'hidden';`).
5. **Anti-Redirect Player**:
   - Ensure all video URLs route to `player.html` with declarativeNetRequest Referer injection so that CDNs do not return 302 redirects.

---

## 5. Testing & Verification

Before opening a pull request, run syntax validation across all JavaScript and JSON files:
```bash
node -c "platforms/whatsapp.js" "overlay_manager.js" "core/content_core.js" "background_script.js" "player.js" "popup.js" "content_script.js"
node -c "whatsapp/platform.js" "whatsapp/core/overlay_manager.js" "whatsapp/core/content_core.js" "whatsapp/core/background_core.js" "whatsapp/background.js" "whatsapp/player.js" "whatsapp/popup.js" "whatsapp/content.js"
```

Manual Testing Checklist:
- [ ] Hover over a chat image: Green download button downloads original image.
- [ ] Hover over a chat video: Blue button opens HTML5 player tab (`player.html`) with audio and video.
- [ ] Open a Status story: Overlay buttons appear safely in the top-right corner (`top >= 90px`), completely clear of Play/Pause and Mute controls.
- [ ] Open a photo in the media lightbox: Overlay attaches cleanly to the lightbox image; background chat buttons are suppressed.
- [ ] Scroll chat stream: Buttons never jump to `bottom-right` or switch corners; hide cleanly when scrolling behind the sticky conversation header.

---

## 6. Submitting Pull Requests

1. Fork the repository and create a feature branch (`git checkout -b feature/my-feature`).
2. Make your changes adhering to code style and dual-folder synchronization.
3. Commit with a concise semantic message (`git commit -m "feat: Add ..."`).
4. Push to your branch and open a Pull Request against `main`.
