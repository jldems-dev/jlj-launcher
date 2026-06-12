const { app } = require("electron");
const path = require("path");

const { createWindow } = require("./createWindow");
const { createGameStore } = require("./storage/gameStore");

const detectionService = require("./services/gameDetectionService");
const processService = require("./services/processService");
const cpService = require("./services/cpService");
const popupWindowService = require("./services/popupWindowService");
const { createGameTrackingService } = require("./services/gameTrackingService");
const { createGameLaunchService } = require("./services/gameLaunchService");
const { createHostService } = require("./services/hostService");
const { createGameUpdateService } = require("./services/gameUpdateService");
const { registerIpcHandlers } = require("./ipc/registerIpcHandlers");   
const adminSocketService = require("./services/adminSocketService");
const systemActivityService = require("./services/systemActivityService");
const { autoUpdater } = require("electron-updater");


function bootstrap() {
  let mainWindow;
  let splash;

  const getMainWindow = () => mainWindow;

  const store = createGameStore(app); 

  function focusWindow(win) {
    if (!win || win.isDestroyed()) return false;

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();

    win.focus();
    win.moveTop();
    return true;
  }

  function focusExistingInstance() {
    if (focusWindow(mainWindow)) return;
    focusWindow(splash);
  }

  app.on("second-instance", () => {
    focusExistingInstance();
  });

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
    systemActivityService,
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
    cpService,
    popupWindowService,
    adminSocketService,
  });

  // =========================
  // APP START
  // =========================
  app.whenReady().then(async () => {
    systemActivityService.start();
    systemActivityService.onChange((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("system-idle-state", state);
      }
    });

    app.setLoginItemSettings({
      openAtLogin: true,
    });
    // 1. SHOW SPLASH IMMEDIATELY
    splash = new (require("electron").BrowserWindow)({
      width: 420,
      height: 300,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
    });
    splash.loadFile(path.join(__dirname, "../renderer/splash.html")); 
    try {
      await store.init();
    } catch (err) {
      console.error("Failed to initialize store:", err);
    }
    // 3. CREATE MAIN WINDOW HIDDEN
    mainWindow = createWindow({
      show: false,
    });
    // 4. WAIT UNTIL MAIN WINDOW IS READY
    mainWindow.once("ready-to-show", async () => {
      try {
        // 5. BACKGROUND BOOTSTRAP
        setupAutoUpdates(mainWindow);

        adminSocketService.connectSocketFromStore(store);
      } catch (err) {
        console.error("Bootstrap error:", err);
      }

      // 6. SMOOTH TRANSITION
      setTimeout(() => {
        splash.close();

        mainWindow.show();
      }, 500);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    systemActivityService.stop();
  });

  app.on("activate", () => {
    const { BrowserWindow } = require("electron");
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}

module.exports = { bootstrap };
