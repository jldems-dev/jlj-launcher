const { app } = require("electron");
const path = require("path");

function createBrowserWindowOptions(options = {}) {
  const root = app.getAppPath();

  return {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: options.show ?? true,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#050505",
    fullscreen: true,
    icon: path.join(root, "assets", "images", "favicon-512x512.png"),

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(root, "src", "preload", "electronApi.js"),
    },
  };
}

module.exports = { createBrowserWindowOptions };
