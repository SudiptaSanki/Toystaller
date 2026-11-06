// player.js
// Handles video playback and direct download inside the Toystaller Player tab.

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('url');

    const player = document.getElementById('videoPlayer');
    const dlBtn = document.getElementById('dlBtn');
    const copyBtn = document.getElementById('copyBtn');
    const resText = document.getElementById('resolutionText');

    if (!videoUrl) {
        document.body.innerHTML = `
            <div style="color:#e4e6eb;font-family:sans-serif;text-align:center;margin-top:25vh;">
                <h2>No video link specified</h2>
                <p style="margin-top:10px;color:#8a8d91;">Please close this tab and click the download button on a Facebook video or reel.</p>
            </div>
        `;
        return;
    }

    player.src = videoUrl;

    player.addEventListener('loadedmetadata', () => {
        if (player.videoWidth && player.videoHeight) {
            resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
        }
    });

    player.addEventListener('error', () => {
        resText.textContent = 'Unable to stream directly. Please click "Download Video" above to save the file.';
        resText.style.color = '#e74c3c';
    });

    dlBtn.addEventListener('click', () => {
        const idMatch = videoUrl.match(/\/(\d+_[^/?]+)/);
        const filename = idMatch ? `Facebook_${idMatch[1]}.mp4` : `Facebook_Video_${Date.now()}.mp4`;
        
        chrome.runtime.sendMessage({
            action: 'downloadMedia',
            url: videoUrl,
            filename: filename
        }, (response) => {
            if (response && response.success) {
                dlBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Download Started
                `;
                setTimeout(() => {
                    dlBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download Video
                    `;
                }, 2500);
            }
        });
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(videoUrl).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy Link
                `;
            }, 1800);
        });
    });
})();

