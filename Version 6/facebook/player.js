// player.js
// Handles video playback and direct download inside the Toystaller Facebook Player tab.

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('url');
    const audioUrl = params.get('audioUrl');

    const player = document.getElementById('videoPlayer');
    const audioPlayer = document.getElementById('audioPlayer');
    const dlBtn = document.getElementById('dlBtn');
    const dlAudioBtn = document.getElementById('dlAudioBtn');
    const copyBtn = document.getElementById('copyBtn');
    const resText = document.getElementById('resolutionText');
    const formatText = document.getElementById('formatText');
    const playerLoader = document.getElementById('playerLoader');
    const loaderTitle = document.getElementById('loaderTitle');
    const loaderSubText = document.getElementById('loaderSubText');
    const retryBtn = document.getElementById('retryBtn');

    function hidePlayerLoader() {
        if (playerLoader) {
            playerLoader.style.opacity = '0';
            setTimeout(() => { playerLoader.style.display = 'none'; }, 250);
        }
    }

    function showPlayerLoader(title, sub, showRetry = false) {
        if (playerLoader) {
            playerLoader.style.display = 'flex';
            playerLoader.style.opacity = '1';
            if (loaderTitle && title) loaderTitle.textContent = title;
            if (loaderSubText && sub) loaderSubText.textContent = sub;
            if (retryBtn) retryBtn.style.display = showRetry ? 'inline-flex' : 'none';
        }
    }

    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }

    if (!videoUrl) {
        document.body.innerHTML = `
            <div style="color:#e4e6eb;font-family:sans-serif;text-align:center;margin-top:25vh;">
                <h2>No video link specified</h2>
                <p style="margin-top:10px;color:#8a8d91;">Please close this tab and click the download button on a Facebook video or reel.</p>
            </div>
        `;
        return;
    }

    const cleanVideoUrl = videoUrl.split('#')[0];
    const cleanAudioUrl = audioUrl ? audioUrl.split('#')[0] : null;

    showPlayerLoader('Loading Master Quality Stream...', 'Optimizing master audio and video for your display', false);
    const bufferTimeout = setTimeout(() => {
        showPlayerLoader('Stream is buffering...', 'If buffering takes longer than expected, click below to reload or download directly.', true);
    }, 4500);

    const onPlaybackReady = () => {
        clearTimeout(bufferTimeout);
        hidePlayerLoader();
    };

    player.addEventListener('loadeddata', onPlaybackReady);
    player.addEventListener('canplay', onPlaybackReady);
    player.addEventListener('playing', onPlaybackReady);

    player.src = cleanVideoUrl;

    if (cleanAudioUrl && audioPlayer) {
        audioPlayer.src = cleanAudioUrl;
        if (formatText) formatText.textContent = 'Direct DASH Stream (Synced Audio + Video)';
        if (dlAudioBtn) dlAudioBtn.style.display = 'inline-flex';

        const syncAudio = () => {
            audioPlayer.currentTime = player.currentTime;
            audioPlayer.volume = player.volume;
            audioPlayer.muted = player.muted;
            if (!player.paused) {
                audioPlayer.play().catch(() => {});
            } else {
                audioPlayer.pause();
            }
        };

        player.addEventListener('play', syncAudio);
        player.addEventListener('pause', syncAudio);
        player.addEventListener('seeking', syncAudio);
        player.addEventListener('seeked', syncAudio);
        player.addEventListener('volumechange', syncAudio);

        dlAudioBtn.addEventListener('click', () => {
            const filename = `Facebook_Audio_${Date.now()}.mp3`;
            chrome.runtime.sendMessage({
                action: 'downloadMedia',
                url: cleanAudioUrl,
                filename: filename
            }, (response) => {
                if (response && response.success) {
                    dlAudioBtn.textContent = 'Audio Downloaded';
                    setTimeout(() => { dlAudioBtn.textContent = 'Download Audio'; }, 2500);
                }
            });
        });
    }

    player.addEventListener('loadedmetadata', () => {
        if (player.videoWidth && player.videoHeight) {
            resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
        }
    });

    player.addEventListener('error', () => {
        clearTimeout(bufferTimeout);
        showPlayerLoader('Preview Blocked by Host', 'Click "Download Video" above to save the master MP4 directly, or reload.', true);
        resText.textContent = 'Preview blocked by host headers. Click "Download Video" above to save the master MP4 directly.';
        resText.style.color = '#e74c3c';
    });

    dlBtn.addEventListener('click', () => {
        const idMatch = cleanVideoUrl.match(/\/(\d+_[^/?]+)/);
        const filename = idMatch ? `Facebook_${idMatch[1]}.mp4` : `Facebook_Video_${Date.now()}.mp4`;
        
        chrome.runtime.sendMessage({
            action: 'downloadMedia',
            url: cleanVideoUrl,
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
        navigator.clipboard.writeText(cleanVideoUrl).then(() => {
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
