"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

function isTrustedMainFrame(event, mainWindow, app) {
  if (!event || !mainWindow || mainWindow.isDestroyed?.()) return false;
  const contents = mainWindow.webContents;
  if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== "file:") return false;
    return path.resolve(fileURLToPath(url)) === path.resolve(app.getAppPath(), "index.html");
  } catch {
    return false;
  }
}

function requireTrustedOwner(event, { mainWindow, app, ownerSession }) {
  if (!isTrustedMainFrame(event, mainWindow, app)) throw new Error("Unauthorized IPC sender");
  if (!ownerSession.isActive(event.sender.id)) throw new Error("Owner session expired; please sign in again");
}

module.exports = { isTrustedMainFrame, requireTrustedOwner };
