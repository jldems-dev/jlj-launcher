const { app } = require("electron");
const path = require("path");

const { createWindow } = require("./createWindow");
const { createGameStore } = require("./storage/gameStore");

const detectionService = require("./services/gameDetectionService");
const processService = require("./services/processService");
const qosService = require("./services/qosService");
const { createGameTrackingService } = require("./services/gameTrackingService");
const { createGameLaunchService } = require("./services/gameLaunchService");
const { createHostService } = require("./services/hostService");
const { createGameUpdateService } = require("./services/gameUpdateService");
const { registerIpcHandlers } = require("./ipc/registerIpcHandlers");   
const { connectSocket } = require("./services/adminSocketService");
const { autoUpdater } = require("electron-updater");

function bootstrap() {
  let mainWindow;
  let splash;

  const getMainWindow = () => mainWindow;

  const store = createGameStore(app); 

  // =========================
  // AUTO UPDATER
  // =========================
  function setupAutoUpdates(win) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      win.webContents.send("update-status", { status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      win.webContents.send("update-status", {
        status: "available",
        version: info.version,
      });
    });

    autoUpdater.on("update-not-available", () => {
      win.webContents.send("update-status", { status: "none" });
    });

    autoUpdater.on("download-progress", (progress) => {
      win.webContents.send("update-progress", {
        percent: progress.percent.toFixed(2),
        speed: progress.bytesPerSecond,
      });
    });

    autoUpdater.on("update-downloaded", () => {
      win.webContents.send("update-status", { status: "ready" });
    });

    autoUpdater.on("error", (err) => {
      win.webContents.send("update-status", {
        status: "error",
        message: err.message,
      });
    });

    autoUpdater.checkForUpdates();
  }

  const updateService = createGameUpdateService({ store });

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
    ipcMain: require("electron").ipcMain,
    autoUpdater,
    store,
    trackingService,
    launchService,
    detectionService,
    hostService,
    updateService,
    getMainWindow, 
    qosService,
  });

  // =========================
  // APP START
  // =========================
  app.whenReady().then(() => {
    // 1. SPLASH FIRST (instant UI)
    splash = new (require("electron").BrowserWindow)({
      width: 420,
      height: 300,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
    });

    splash.loadFile(path.join(__dirname, "../renderer/splash.html"));

    // 2. CREATE MAIN WINDOW (hidden)
    mainWindow = createWindow({
      show: false, // IMPORTANT
    });

    mainWindow.once("ready-to-show", () => {
      // 3. SWITCH SPLASH → MAIN
      setTimeout(() => {
        splash.close();
        mainWindow.show();
      }, 500); // smooth transition
    }); 

    // 4. BACKGROUND BOOTSTRAP (NO BLOCKING UI)
    setImmediate(async () => {
      try {
        await store.init();

        setupAutoUpdates(mainWindow);
        // connectSocket();
      } catch (err) {
        console.error("Bootstrap error:", err);
      }
    });
  });

  app.on("window-all-closed", () => {
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
