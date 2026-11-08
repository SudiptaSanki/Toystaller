// background_script.js
// Toystaller Global v6.0 — Universal media interception, download dispatcher, and in-browser anti-redirect HTML5 player routing.

const interceptedMedia = {};
const viewerMediaCache = new Map();

const mediaExtensions = ['.mp4', '.m3u8', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.m4a'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

// Listen for network media requests across all platforms
chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const { tabId, url, type } = details;
        if (tabId < 0) return;

        const lowerUrl = url.toLowerCase();

        // Recognize CDN domains
        const isInstagramCdn = lowerUrl.includes('cdninstagram.com');
        const isFacebookCdn = lowerUrl.includes('fbcdn.net') || lowerUrl.includes('fbsbx.com');
        const isLinkedInCdn = lowerUrl.includes('licdn.com') || lowerUrl.includes('linkedin.com');
        const isWhatsAppCdn = lowerUrl.includes('whatsapp.net') || lowerUrl.includes('whatsapp.com');
        const isKnownCdn = isInstagramCdn || isFacebookCdn || isLinkedInCdn || isWhatsAppCdn;

        if (!isKnownCdn && type !== 'media' && type !== 'image') return;

        const isAudio = lowerUrl.includes('/v/t42.') ||
                        lowerUrl.includes('mime=audio') ||
                        lowerUrl.includes('mime%3daudio') ||
                        lowerUrl.includes('stream_type=audio') ||
                        lowerUrl.includes('/audio/') ||
                        lowerUrl.includes('audio_');

        const isVideo = !isAudio && (
                        (type === 'media') ||
                        (mediaExtensions.some(ext => lowerUrl.includes(ext))) ||
                        lowerUrl.includes('mime=video') ||
                        lowerUrl.includes('stream_type=dash') ||
                        lowerUrl.includes('/video/') ||
                        lowerUrl.includes('playback') ||
                        lowerUrl.includes('videoplayback') ||
                        lowerUrl.includes('/v/t64.') ||
                        lowerUrl.includes('/v/t66.') ||
                        lowerUrl.includes('/o1/v/') ||
                        (lowerUrl.includes('fbcdn.net') && (lowerUrl.includes('/v/') || lowerUrl.includes('video.'))));

        const isImage = (type === 'image') ||
                        (imageExtensions.some(ext => lowerUrl.includes(ext))) ||
                        lowerUrl.includes('media.licdn.com/dms/image') ||
                        lowerUrl.includes('/t39.30808-6/') ||
                        lowerUrl.includes('/p50x50/');

        if (isVideo || isAudio || isImage) {
            if (!interceptedMedia[tabId]) {
                interceptedMedia[tabId] = { video: new Set(), audio: new Set(), img: new Set() };
            }

            if (isAudio && !lowerUrl.includes('.mpd') && !lowerUrl.includes('manifest')) {
                let clean = url.replace(/\\\//g, '/')
                               .replace(/&amp;/g, '&')
                               .replace(/\\u0026/g, '&')
                               .replace(/([?&])bytestart=\d+&?/g, '$1')
                               .replace(/([?&])byteend=\d+&?/g, '$1')
                               .replace(/[?&]$/, '')
                               .trim();
                interceptedMedia[tabId].audio.add(clean);
            } else if (isVideo && !lowerUrl.includes('/audio') && !lowerUrl.includes('.mpd') && !lowerUrl.includes('manifest')) {
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
        const audioUrls = tabMedia && tabMedia.audio ? Array.from(tabMedia.audio) : [];
        sendResponse({ urls: urls, audioUrls: audioUrls });
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
            platform: request.platform || 'WhatsApp',
            timestamp: Date.now()
        });

        setTimeout(() => {
            if (viewerMediaCache.has(id)) {
                viewerMediaCache.delete(id);
            }
        }, 120000);

        chrome.storage.local.get({ openInMainWindow: false }, (settings) => {
            const stayInCurrent = !settings.openInMainWindow;
            const targetUrl = chrome.runtime.getURL(`player.html?id=${id}`);
            const tabProps = { url: targetUrl };

            if (stayInCurrent && sender.tab && sender.tab.windowId) {
                tabProps.windowId = sender.tab.windowId;
                if (typeof sender.tab.index === 'number') {
                    tabProps.index = sender.tab.index + 1;
                }
            }

            chrome.tabs.create(tabProps, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error("Toystaller: Failed to create player tab with windowId:", chrome.runtime.lastError.message);
                    const fallbackProps = { url: request.url || targetUrl };
                    if (stayInCurrent && sender.tab && sender.tab.windowId) {
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
        const isVideo = request.isVideo !== undefined ? request.isVideo : (
            lowerUrl.includes('.mp4') || 
            lowerUrl.includes('.m3u8') ||
            lowerUrl.includes('.m4v') || 
            lowerUrl.includes('.webm') || 
            lowerUrl.includes('/video/') || 
            lowerUrl.includes('playback') ||
            lowerUrl.includes('mime=video')
        );

        const platform = request.platform || '';
        const platformLower = platform.toLowerCase();
        
        // Check if this media specifically requires the Toystaller anti-hotlink player wrapper
        const isSpecialVideoPlatform = (
            platformLower === 'facebook' || 
            platformLower === 'linkedin' || 
            platformLower === 'instagram' || 
            platformLower === 'whatsapp' ||
            lowerUrl.includes('fbcdn.net') ||
            lowerUrl.includes('fbsbx.com') ||
            lowerUrl.includes('licdn.com') ||
            lowerUrl.includes('cdninstagram.com') ||
            lowerUrl.includes('whatsapp.net')
        );
        const isHlsStream = lowerUrl.includes('.m3u8') || lowerUrl.includes('/manifest/') || lowerUrl.includes('/playlist/');

        // CRITICAL LOGIC:
        // Only use player.html for videos that actually require header spoofing/in-browser decoding (anti-hotlink CDNs, HLS).
        // For ALL images (Amazon, Pexels, Unsplash, Google, etc.) and regular website videos,
        // directly pop out the raw URL in the new tab. This avoids cross-origin embedding blocks (CORS/CORP) and guarantees 100% display!
        const isDataUrl = lowerUrl.startsWith('data:');
        const shouldUsePlayer = (isVideo && (isSpecialVideoPlatform || isHlsStream || request.forcePlayer)) || isDataUrl;

        let playerUrl = chrome.runtime.getURL('player.html') + 
            '?url=' + encodeURIComponent(url) + 
            (platform ? '&platform=' + encodeURIComponent(platform) : '');
        if (request.audioUrl) {
            playerUrl += '&audioUrl=' + encodeURIComponent(request.audioUrl);
        }
        if (request.mutedUrl) {
            playerUrl += '&mutedUrl=' + encodeURIComponent(request.mutedUrl);
        }
        
        const targetUrl = shouldUsePlayer ? playerUrl : url;

        // Target the exact window where the click occurred (keeps incognito in incognito!)
        chrome.storage.local.get({ openInMainWindow: false }, (settings) => {
            const stayInCurrent = !settings.openInMainWindow;
            const tabProps = { url: targetUrl };

            if (stayInCurrent && sender.tab && sender.tab.windowId) {
                tabProps.windowId = sender.tab.windowId;
                if (typeof sender.tab.index === 'number') {
                    tabProps.index = sender.tab.index + 1;
                }
            }

            chrome.tabs.create(tabProps, (createdTab) => {
                if (chrome.runtime.lastError) {
                    console.warn("Toystaller: tabs.create failed with player.html:", chrome.runtime.lastError.message);
                    // Fallback: stay in the SAME window, using direct media URL if player.html was rejected in incognito
                    const fallbackProps = { url: url || targetUrl };
                    if (stayInCurrent && sender.tab && sender.tab.windowId) {
                        fallbackProps.windowId = sender.tab.windowId;
                        if (typeof sender.tab.index === 'number') {
                            fallbackProps.index = sender.tab.index + 1;
                        }
                    }
                    chrome.tabs.create(fallbackProps, (fbTab) => {
                        if (chrome.runtime.lastError) {
                            console.error("Toystaller: Fallback tabs.create also failed:", chrome.runtime.lastError.message);
                        }
                    });
                }
            });
        });

        sendResponse({ success: true });
        return true;
    } else if (request.action === 'fetchMobileFacebookVideo') {
        let videoId = request.videoId;
        if (!videoId && request.url) {
            const vMatch = request.url.match(/(?:videos\/|watch\/?\?v=|reel\/)(\d+)/);
            if (vMatch) videoId = vMatch[1];
        }

        const targetUrl = videoId
            ? `https://www.facebook.com/watch/?v=${videoId}&_rdr`
            : (request.url || 'https://www.facebook.com');

        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Sec-Fetch-Mode': 'navigate'
            }
        })
        .then(r => r.text())
        .then(html => {
            let videoUrl = null;

            // 1. Check browser_native_hd_url (Progressive 720p HD MP4 with audio)
            const nativeHdMatch = html.match(/"browser_native_hd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
            if (nativeHdMatch && nativeHdMatch[1]) {
                try {
                    videoUrl = JSON.parse('"' + nativeHdMatch[1] + '"');
                } catch (e) {
                    videoUrl = nativeHdMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
                }
            }

            // 2. Check playable_url_quality_hd
            if (!videoUrl) {
                const hdMatch = html.match(/"playable_url_quality_hd"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (hdMatch && hdMatch[1]) {
                    try {
                        videoUrl = JSON.parse('"' + hdMatch[1] + '"');
                    } catch (e) {
                        videoUrl = hdMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
                    }
                }
            }

            // 3. Check progressive_download_url
            if (!videoUrl) {
                const progMatch = html.match(/"progressive_download_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (progMatch && progMatch[1]) {
                    try {
                        videoUrl = JSON.parse('"' + progMatch[1] + '"');
                    } catch (e) {
                        videoUrl = progMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
                    }
                }
            }

            // 4. Check browser_native_sd_url
            if (!videoUrl) {
                const nativeSdMatch = html.match(/"browser_native_sd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (nativeSdMatch && nativeSdMatch[1]) {
                    try {
                        videoUrl = JSON.parse('"' + nativeSdMatch[1] + '"');
                    } catch (e) {
                        videoUrl = nativeSdMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
                    }
                }
            }

            // 5. Check playable_url
            if (!videoUrl) {
                const playableMatch = html.match(/"playable_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                if (playableMatch && playableMatch[1]) {
                    try {
                        videoUrl = JSON.parse('"' + playableMatch[1] + '"');
                    } catch (e) {
                        videoUrl = playableMatch[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
                    }
                }
            }

            // 6. Direct CDN regex scan
            if (!videoUrl) {
                const srcMatch = html.match(/src="([^"]+?\.mp4[^"]*?)"/);
                if (srcMatch && srcMatch[1]) {
                    videoUrl = srcMatch[1].replace(/&amp;/g, '&').replace(/\\\//g, '/');
                }
            }

            sendResponse({ url: videoUrl, videoId: videoId });
        })
        .catch(err => {
            console.error("Facebook watch fetch error:", err);
            sendResponse({ url: null });
        });
        return true;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete interceptedMedia[tabId];
});

chrome.action.onClicked.addListener((tab) => {
    if (tab && tab.id > 0) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleDashboard' }).catch(() => {});
    }
});
