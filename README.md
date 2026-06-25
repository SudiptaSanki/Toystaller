# Toystaller - Version 4 (Page-Aware Media Extraction)

Toystaller is a lightweight, secure browser extension that extracts high-quality media URLs and adds hover action buttons to videos and images across the web.

**Looking for previous releases?** 
- [Version 3 (Smart Dashboard & Shadow DOM UI)](https://github.com/SudiptaSanki/Toystaller/tree/v3)
- [Version 2 (Smart Placement & LinkedIn Support)](https://github.com/SudiptaSanki/Toystaller/tree/v2)
- [Version 1 (Classic Instagram Layout)](https://github.com/SudiptaSanki/Toystaller/tree/v1)

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=google-chrome&logoColor=white)](#)
[![100% Local Security](https://img.shields.io/badge/Security-100%25%20Local-success?style=for-the-badge&logo=shield-halved&logoColor=white)](#)

---

## 🚀 What's New in Version 4

Version 4 introduces the **Platform Abstraction Layer**, allowing Toystaller to understand the specific UI layout and page context of Instagram and LinkedIn to perfectly place action buttons and avoid UI overlap.

| Feature | Description |
|---------------|-----------|
| **Overflow-Clip Detection** | Buttons are no longer injected on media that is physically hidden inside `overflow: hidden` or scrollable carousel containers, even if they pass standard intersection checks. |
| **LinkedIn Modals Fixed** | Fixed a critical bug where LinkedIn's messaging tab (which uses `role="dialog"`) was mistakenly treated as a full-screen modal, blocking feed videos. Modals are now tracked using LinkedIn's native `.artdeco-modal` classes. |
| **Instagram Modal Context** | When viewing an Instagram post inside a modal (popup overlay), Toystaller automatically hides buttons for the background feed, keeping your focus strictly on the active media. |
| **DM Chat Extraction** | Full support for Instagram Private Messages. Intercepts GraphQL API responses to accurately extract progressive video URLs shared in DMs, with scaled-down buttons to avoid UI clashes. |
| **Platform Contexts** | The extension now dynamically adjusts its logic based on the specific page you are on (e.g. `ig-reels`, `li-messaging`, `ig-post-modal`). |

---

## 🔒 Security & Privacy

- **100% Local Processing**: All code runs entirely in your local browser sandbox. No user tracking, no third-party APIs, and no external analytics.
- **Privacy First**: Sniffed media URLs and React state properties never leave your device.

---

## ⚙️ Installation

1. Clone or download this repository.
2. Open your browser extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the cloned repository folder.

---

## ⚖️ Disclaimer & License

**For Educational Purposes Only.**
We do not take any responsibility for illegal activities or policy violations. This extension is designed solely for educational analysis and local media viewing. Users are fully responsible for ensuring compliance with the terms of service of any third-party websites they interact with.
