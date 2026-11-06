// extensions/global/content.js
// Toystaller Global — multi-platform content script entry point.
// Routes to the correct platform based on hostname and sets up the active platform.

(function() {
    const host = window.location.hostname.toLowerCase();

    // Determine which platform to activate
    function resolveActivePlatform() {
        const platforms = window.ToystallerPlatforms;
        if (!platforms) return null;
        if (host.includes('instagram.com')) return platforms['instagram'];
        if (host.includes('linkedin.com')) return platforms['linkedin'];
        if (host.includes('facebook.com')) return platforms['facebook'];
        if (host.includes('whatsapp.com')) return platforms['whatsapp'];
        return platforms['generic'] || null;
    }

    const platform = resolveActivePlatform();
    if (platform) {
        window.ToystallerActivePlatform = platform;
        window.ToystallerPlatform = platform;
    }

    // Only inject the active platform's script into the MAIN world to prevent clashes
    let activeScript = 'platforms/generic.js';
    let platformKey = 'generic';
    if (host.includes('instagram.com')) { activeScript = 'platforms/instagram.js'; platformKey = 'instagram'; }
    else if (host.includes('linkedin.com')) { activeScript = 'platforms/linkedin.js'; platformKey = 'linkedin'; }
    else if (host.includes('facebook.com')) { activeScript = 'platforms/facebook.js'; platformKey = 'facebook'; }
    else if (host.includes('whatsapp.com')) { activeScript = 'platforms/whatsapp.js'; platformKey = 'whatsapp'; }

    const platformScripts = [
        activeScript,
        'core/interceptor_core.js'
    ];

    const routerCode = `
        (function() {
            const platforms = window.ToystallerPlatforms || {};
            if (platforms['${platformKey}']) {
                window.ToystallerPlatform = platforms['${platformKey}'];
                window.ToystallerActivePlatform = platforms['${platformKey}'];
            }
        })();
    `;

    bootToystaller(platformScripts, routerCode);
})();
