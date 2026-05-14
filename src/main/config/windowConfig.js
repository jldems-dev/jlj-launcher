const path = require('path');

function createBrowserWindowOptions(rootDir) {
    return {
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        /* frame: false,
        titleBarStyle: 'hidden', */
        backgroundColor: '#050505',
        icon: path.join(rootDir, 'assets', 'images', 'favicon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(rootDir, 'preload.js')
        }
    };
}

module.exports = { createBrowserWindowOptions };
