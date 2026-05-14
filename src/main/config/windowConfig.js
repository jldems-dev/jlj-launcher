const { app } = require("electron");
const path = require("path");

function createBrowserWindowOptions() {
  const root = app.getAppPath();

  return {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#050505",

    icon: path.join(root, "assets", "images", "favicon-512x512.png"),

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(root, "preload.js"),
    },
  };
}

module.exports = { createBrowserWindowOptions };
