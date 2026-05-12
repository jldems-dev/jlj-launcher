const { BrowserWindow } = require('electron');
const { createBrowserWindowOptions } = require('./config/windowConfig');

function createWindow(rootDir) {
    const mainWindow = new BrowserWindow(createBrowserWindowOptions(rootDir));
    mainWindow.loadFile('index.html');
    return mainWindow;
}

module.exports = { createWindow };
