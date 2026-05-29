const { BrowserWindow, screen } = require("electron");
const path = require("path");

let popupWindow = null;
let closeTimeout = null;

function showPopup(data) {
  const windowWidth = 420;
  const windowHeight = 160;

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  const centerX = Math.round((width - windowWidth) / 2);
  const centerY = Math.round((height - windowHeight) / 2);

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
  }

  popupWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: centerX,
    y: centerY,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  popupWindow.setAlwaysOnTop(true, "screen-saver");

  popupWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  const popupPath = path.join(__dirname, "../../renderer/popup.html");

  popupWindow.loadFile(popupPath);

  popupWindow.once("ready-to-show", () => {
    popupWindow.showInactive();

    popupWindow.webContents.send("popup-data", {
      title: data.title || "Notification",
      message: data.message || "",
      type: data.type || "info",
    });
  });

  popupWindow.on("closed", () => {
    popupWindow = null;

    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = null;
    }
  });

  closeTimeout = setTimeout(() => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close();
    }
  }, 10000);
}

module.exports = {
  showPopup,
};
