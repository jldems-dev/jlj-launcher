const { BrowserWindow, app } = require("electron");
const path = require("path");
const { createBrowserWindowOptions } = require("./config/windowConfig");

function createWindow() {
  const mainWindow = new BrowserWindow(createBrowserWindowOptions());

  // ✅ FIX: production-safe path
  mainWindow.loadFile(path.join(app.getAppPath(), "index.html"));

  return mainWindow;
}

module.exports = { createWindow };
