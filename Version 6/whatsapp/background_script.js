// background_script.js
// Toystaller v1.0 (WhatsApp Edition) — Media interception, download dispatcher, and in-browser player routing.

const interceptedMedia = {};
const viewerMediaCache = new Map();

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
    { urls: ["*://web.whatsapp.com/*", "*://*.whatsapp.net/*", "*://*.whatsapp.com/*"] }
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getMediaUrls') {
        const tabId = sender.tab ? sender.tab.id : request.tabId;
        const mediaType = request.mediaType;
        const tabMedia = interceptedMedia[tabId];
        const urls = tabMedia && tabMedia[mediaType] ? Array.from(tabMedia[mediaType]) : [];
        sendResponse({ urls: urls });
    } else if (request.action === 'downloadMedia') {
        const downloadOptions = {
            url: request.url,
            saveAs: request.saveAs !== undefined ? request.saveAs : true
        };
        if (request.filename) {
            downloadOptions.filename = request.filename;
        }

        chrome.downloads.download(downloadOptions, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Toystaller: Download failed:", chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId: downloadId });
            }
        });
        return true;
    } else if (request.action === 'createPlayerTab' || request.action === 'createViewerTab') {
        const id = 'player_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        viewerMediaCache.set(id, {
            dataUrl: request.dataUrl,
            url: request.url,
            buffer: request.buffer,
            mimeType: request.mimeType,
            isVideo: request.isVideo !== undefined ? request.isVideo : true,
            filename: request.filename,
            timestamp: Date.now()
        });

        // 120-second automatic garbage collection if tab isn't opened
        setTimeout(() => {
            if (viewerMediaCache.has(id)) {
                viewerMediaCache.delete(id);
            }
        }, 120000);

        const tabProps = { url: chrome.runtime.getURL(`player.html?id=${id}`) };
        if (sender.tab && sender.tab.windowId) {
            tabProps.windowId = sender.tab.windowId;
            if (typeof sender.tab.index === 'number') tabProps.index = sender.tab.index + 1;
        }
        chrome.tabs.create(tabProps, (tab) => {
            if (chrome.runtime.lastError) {
                console.error("Toystaller: Failed to create player tab with windowId:", chrome.runtime.lastError.message);
                const fallbackProps = { url: request.url || tabProps.url };
                if (sender.tab && sender.tab.windowId) {
                    fallbackProps.windowId = sender.tab.windowId;
                    if (typeof sender.tab.index === 'number') fallbackProps.index = sender.tab.index + 1;
                }
                chrome.tabs.create(fallbackProps, (fallbackTab) => {
                    sendResponse({ success: true, id: id, tabId: fallbackTab ? fallbackTab.id : null });
                });
            } else {
                sendResponse({ success: true, id: id, tabId: tab ? tab.id : null });
            }
        });
        return true;
    } else if (request.action === 'getPlayerMedia' || request.action === 'getViewerMedia') {
        const id = request.id;
        const media = viewerMediaCache.get(id);
        if (media) {
            viewerMediaCache.delete(id);
            sendResponse(media);
        } else {
            sendResponse(null);
        }
        return true;
    } else if (request.action === 'openInNewTab') {
        const url = request.url || '';
        const lowerUrl = url.toLowerCase();
        const isVideo = request.isVideo || 
                        lowerUrl.includes('.mp4') || 
                        lowerUrl.includes('.m4v') || 
                        lowerUrl.includes('.webm') || 
                        lowerUrl.includes('/video/') || 
                        lowerUrl.includes('mime=video');

        const targetUrl = isVideo ? (chrome.runtime.getURL('player.html') + '?url=' + encodeURIComponent(url)) : url;
        const tabProps = { url: targetUrl };
        if (sender.tab && sender.tab.windowId) {
            tabProps.windowId = sender.tab.windowId;
            if (typeof sender.tab.index === 'number') tabProps.index = sender.tab.index + 1;
        }
        chrome.tabs.create(tabProps, (createdTab) => {
            if (chrome.runtime.lastError) {
                console.warn("Toystaller: tabs.create failed, falling back to direct url in same window:", chrome.runtime.lastError.message);
                const fallbackProps = { url: url || targetUrl };
                if (sender.tab && sender.tab.windowId) {
                    fallbackProps.windowId = sender.tab.windowId;
                    if (typeof sender.tab.index === 'number') fallbackProps.index = sender.tab.index + 1;
                }
                chrome.tabs.create(fallbackProps);
            }
        });
        sendResponse({ success: true });
        return true;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete interceptedMedia[tabId];
});

if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener((tab) => {
        if (tab && tab.id > 0) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggleDashboard' }).catch(() => {});
        }
    });
}
