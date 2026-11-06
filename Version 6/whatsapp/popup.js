// popup.js — Manages toggle settings for Toystaller WhatsApp overlay visibility per section

const TOGGLE_KEYS = {
    toggleChat:     'toystaller_wa_chat',
    toggleStatus:   'toystaller_wa_status',
    toggleLightbox: 'toystaller_wa_media_viewer',
    toggleProfile:  'toystaller_wa_profile'
};

const DEFAULTS = {
    toystaller_wa_chat:         true,
    toystaller_wa_status:       true,
    toystaller_wa_media_viewer: true,
    toystaller_wa_profile:      true
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

// Save on change and notify active WhatsApp tabs
for (const [elemId, storageKey] of Object.entries(TOGGLE_KEYS)) {
    const el = document.getElementById(elemId);
    if (!el) continue;

    el.addEventListener('change', () => {
        const obj = {};
        obj[storageKey] = el.checked;
        chrome.storage.local.set(obj, () => {
            // Notify all WhatsApp tabs to refresh overlay visibility
            chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (tabs) => {
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
