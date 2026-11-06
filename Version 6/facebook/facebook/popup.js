// popup.js — Manages toggle settings for Toystaller overlay visibility per section on Facebook

const TOGGLE_KEYS = {
    toggleFeed:    'toystaller_fb_show_feed',
    toggleWatch:   'toystaller_fb_show_watch',
    toggleReels:   'toystaller_fb_show_reels',
    toggleStories: 'toystaller_fb_show_stories',
    togglePhotos:  'toystaller_fb_show_photos'
};

const DEFAULTS = {
    toystaller_fb_show_feed:    true,
    toystaller_fb_show_watch:   true,
    toystaller_fb_show_reels:   true,
    toystaller_fb_show_stories: true,
    toystaller_fb_show_photos:  true
};

// Load saved settings into checkboxes
chrome.storage.local.get(Object.values(TOGGLE_KEYS), (result) => {
    for (const [elemId, storageKey] of Object.entries(TOGGLE_KEYS)) {
        const el = document.getElementById(elemId);
        if (!el) continue;
        const val = result[storageKey];
        el.checked = (val === undefined || val === null) ? DEFAULTS[storageKey] : val;
    }
});

// Save on change and notify active Facebook tabs
for (const [elemId, storageKey] of Object.entries(TOGGLE_KEYS)) {
    const el = document.getElementById(elemId);
    if (!el) continue;

    el.addEventListener('change', () => {
        const obj = {};
        obj[storageKey] = el.checked;
        chrome.storage.local.set(obj, () => {
            // Notify all Facebook tabs to refresh overlay visibility
            chrome.tabs.query({ url: '*://*.facebook.com/*' }, (tabs) => {
                for (const tab of tabs) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'toystaller_settings_changed',
                        key: storageKey,
                        value: el.checked
                    }).catch(() => {});
                }
            });
        });
    });
}
