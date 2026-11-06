// core/background_core.js
// Shared background script logic — network interception, downloads, tab management.
// Each platform extension imports this and can add platform-specific handlers.

const interceptedMedia = {};

const mediaExtensions = ['.mp4', '.m3u8', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.m4a'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const { tabId, url, type } = details;
        if (tabId < 0) return;

        const lowerUrl = url.toLowerCase();
        const isVideo = type === 'media' ||
                        mediaExtensions.some(ext => lowerUrl.includes(ext)) ||
                        lowerUrl.includes('mime=video') ||
                        lowerUrl.includes('/video/');
        const isImage = type === 'image' || imageExtensions.some(ext => lowerUrl.includes(ext));

        if (isVideo || isImage) {
            if (!interceptedMedia[tabId]) {
                interceptedMedia[tabId] = { video: new Set(), img: new Set() };
            }
            if (isVideo) {
                interceptedMedia[tabId].video.add(url);
            } else if (isImage) {
                interceptedMedia[tabId].img.add(url);
            }
        }
    },
    { urls: ["<all_urls>"] }
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getMediaUrls') {
        const tabId = sender.tab ? sender.tab.id : request.tabId;
        const mediaType = request.mediaType;
        const tabMedia = interceptedMedia[tabId];
        const urls = tabMedia && tabMedia[mediaType] ? Array.from(tabMedia[mediaType]) : [];
        sendResponse({ urls: urls });
    } else if (request.action === 'downloadMedia') {
        chrome.downloads.download({
            url: request.url,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId: downloadId });
            }
        });
        return true;
    } else if (request.action === 'openInNewTab') {
        const url = request.url || '';
        const platform = request.platform || '';
        const playerUrl = chrome.runtime.getURL('player.html') + 
            '?url=' + encodeURIComponent(url) + 
            (platform ? '&platform=' + encodeURIComponent(platform) : '');
        
        chrome.storage.local.get({ openInMainWindow: false }, (settings) => {
            const stayInCurrent = !settings.openInMainWindow;
            const tabProps = { url: playerUrl };

            if (stayInCurrent && sender.tab) {
                tabProps.windowId = sender.tab.windowId;
                tabProps.openerTabId = sender.tab.id;
                tabProps.index = sender.tab.index + 1;
            }

            chrome.tabs.create(tabProps, (createdTab) => {
                if (chrome.runtime.lastError) {
                    chrome.tabs.create({ url: playerUrl });
                }
            });
        });
        sendResponse({ success: true });
        return true;
    }
    // Platform-specific handlers are added by each extension's background.js
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete interceptedMedia[tabId];
});

chrome.action.onClicked.addListener((tab) => {
    if (tab.id > 0) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleDashboard' }).catch(err => {
            console.log("Error sending toggleDashboard to tab:", err);
        });
    }
});
