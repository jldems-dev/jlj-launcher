const { app, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

const { createWindow } = require("./createWindow");
const { createGameStore } = require("./storage/gameStore");

const detectionService = require("./services/gameDetectionService");
const processService = require("./services/processService");
const { createGameTrackingService } = require("./services/gameTrackingService");
const { createGameLaunchService } = require("./services/gameLaunchService");
const { createHostService } = require("./services/hostService");
const { createGameUpdateService } = require("./services/gameUpdateService");
const { registerIpcHandlers } = require("./ipc/registerIpcHandlers"); 

function bootstrap() {
  let mainWindow;

  const getMainWindow = () => mainWindow;

  const store = createGameStore(app);

  const { autoUpdater } = require("electron-updater");

  function setupAutoUpdates(mainWindow) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      mainWindow.webContents.send("update-status", {
        status: "checking",
      });
    });

    autoUpdater.on("update-available", (info) => {
      mainWindow.webContents.send("update-status", {
        status: "available",
        version: info.version,
      });
    });

    autoUpdater.on("update-not-available", () => {
      mainWindow.webContents.send("update-status", {
        status: "none",
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      mainWindow.webContents.send("update-progress", {
        percent: progress.percent.toFixed(2),
        speed: progress.bytesPerSecond,
      });
    });

    autoUpdater.on("update-downloaded", () => {
      mainWindow.webContents.send("update-status", {
        status: "ready",
      });
    });

    autoUpdater.on("error", (err) => {
      console.error("Auto update error:", err);
      mainWindow.webContents.send("update-status", {
        status: "error",
        message: err.message,
      });
    });

    // 🔥 START CHECK
    autoUpdater.checkForUpdates();
  }
  const updateService = createGameUpdateService({
    store,
  });

  const trackingService = createGameTrackingService({
    store,
    getMainWindow,
    processService,
  });

  const launchService = createGameLaunchService({
    store,
    getMainWindow,
    detectionService,
    processService,
    trackingService,
  });

  const hostService = createHostService();

  registerIpcHandlers({
    ipcMain,
    store,
    trackingService,
    launchService,
    detectionService,
    hostService,
    updateService,
    getMainWindow,
  });

  app.whenReady().then(() => {
    store.init();
    mainWindow = createWindow();
    setupAutoUpdates(mainWindow); 
  });

  app.on("window-all-closed", () => {
    trackingService.stopAll();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    const { BrowserWindow } = require("electron");
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  }); 
}

module.exports = { bootstrap };
