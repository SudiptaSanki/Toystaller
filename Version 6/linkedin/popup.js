// popup.js — Manages toggle settings for Toystaller overlay visibility per section on LinkedIn

const TOGGLE_KEYS = {
    toggleFeed:      'toystaller_li_show_feed',
    toggleArticles:  'toystaller_li_show_articles',
    toggleProfile:   'toystaller_li_show_profile',
    toggleMessaging: 'toystaller_li_show_messaging'
};

const DEFAULTS = {
    toystaller_li_show_feed:      true,
    toystaller_li_show_articles:  true,
    toystaller_li_show_profile:   true,
    toystaller_li_show_messaging: true
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

// Save on change and notify active LinkedIn tabs
for (const [elemId, storageKey] of Object.entries(TOGGLE_KEYS)) {
    const el = document.getElementById(elemId);
    if (!el) continue;

    el.addEventListener('change', () => {
        const obj = {};
        obj[storageKey] = el.checked;
        chrome.storage.local.set(obj, () => {
            // Notify all LinkedIn tabs to refresh overlay visibility
            chrome.tabs.query({ url: '*://*.linkedin.com/*' }, (tabs) => {
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
