// content_script.js
// Toystaller: WhatsApp Edition — Content script entry point.
// Boots Toystaller with WhatsApp platform configuration and interceptor scripts.

bootToystaller([
    'platforms/whatsapp.js',
    'page_interceptor.js'
]);
