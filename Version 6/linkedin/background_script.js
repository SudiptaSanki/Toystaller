// background_script.js
// Listens for media network requests and handles downloads / new-tab opens via anti-redirect HTML5 player.

const interceptedMedia = {};

const mediaExtensions = ['.mp4', '.m3u8', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.m4a'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const { tabId, url, type } = details;
        if (tabId < 0) return;

        const lowerUrl = url.toLowerCase();
        const isCdn = lowerUrl.includes('licdn.com') || lowerUrl.includes('linkedin.com');
        if (!isCdn && type !== 'media') return;

        const isVideo = (type === 'media' && isCdn) ||
                        (isCdn && (
                            mediaExtensions.some(ext => lowerUrl.includes(ext)) ||
                            lowerUrl.includes('mime=video') ||
                            lowerUrl.includes('/video/') ||
                            lowerUrl.includes('playback') ||
                            lowerUrl.includes('videoplayback')
                        ));
        const isImage = (type === 'image' && isCdn) || 
                        (isCdn && (
                            imageExtensions.some(ext => lowerUrl.includes(ext)) ||
                            lowerUrl.includes('media.licdn.com/dms/image')
                        ));

        if (isVideo || isImage) {
            if (!interceptedMedia[tabId]) {
                interceptedMedia[tabId] = { video: new Set(), img: new Set() };
            }
            if (isVideo && !lowerUrl.includes('/audio') && !lowerUrl.includes('.mpd') && !lowerUrl.includes('.m3u8') && !lowerUrl.includes('manifest')) {
                let clean = url.replace(/\\\//g, '/')
                               .replace(/&amp;/g, '&')
                               .replace(/\\u0026/g, '&')
                               .replace(/([?&])bytestart=\d+&?/g, '$1')
                               .replace(/([?&])byteend=\d+&?/g, '$1')
                               .replace(/[?&]$/, '')
                               .trim();
                interceptedMedia[tabId].video.add(clean);
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
        const downloadOptions = {
            url: request.url,
            saveAs: true
        };
        if (request.filename) {
            downloadOptions.filename = request.filename;
        }
        chrome.downloads.download(downloadOptions, (downloadId) => {
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
        const lowerUrl = url.toLowerCase();
        const isVideo = request.isVideo || 
                        lowerUrl.includes('.mp4') || 
                        lowerUrl.includes('.m4v') || 
                        lowerUrl.includes('.webm') || 
                        lowerUrl.includes('/video/') || 
                        lowerUrl.includes('playback') ||
                        lowerUrl.includes('mime=video');
        if (isVideo) {
            const playerUrl = chrome.runtime.getURL('player.html') + '?url=' + encodeURIComponent(url);
            chrome.tabs.create({ url: playerUrl });
        } else {
            chrome.tabs.create({ url: url });
        }
        sendResponse({ success: true });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete interceptedMedia[tabId];
});
