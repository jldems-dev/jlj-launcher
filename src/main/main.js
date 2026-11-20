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
const { createAppUpdateService } = require("./services/appUpdateService");
const { registerIpcHandlers } = require("./ipc/registerIpcHandlers");   
const adminSocketService = require("./services/adminSocketService");
const systemActivityService = require("./services/systemActivityService");
const { autoUpdater } = require("electron-updater");
const { createLoggingService } = require("./services/loggingService");
const { createDiagnosticsService } = require("./services/diagnosticsService");
const { createTrayService } = require("./services/trayService");
const { powerMonitor } = require("electron");
const { createOwnerSession } = require("./security/ownerSession");
const { createWebsiteServiceClient } = require("./websiteAccess/websiteServiceClient");


function bootstrap() {
  let mainWindow;
  let splash;
  let appUpdateService;
  let trayService;
  const ownerSession = createOwnerSession({
    onExpire: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("owner-session-invalidated");
      }
    },
  });

  const getMainWindow = () => mainWindow;

  const logger = createLoggingService(app);
  for (const [method, level] of [["debug", "DEBUG"], ["log", "INFO"], ["info", "INFO"], ["warn", "WARN"], ["error", "ERROR"]]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      const [message, ...details] = args;
      logger.log(level, "main-console", String(message ?? ""), details.length ? details : undefined);
    };
  }
  const store = createGameStore(app);
  const websiteServiceClient = createWebsiteServiceClient();
  process.on("uncaughtException", (error) => {
    logger.log("FATAL", "main", "Uncaught exception; shutting down", error);
    app.quit();
  });
  process.on("unhandledRejection", (reason) => logger.log("ERROR", "main", "Unhandled promise rejection", reason instanceof Error ? reason : { reason }));
  app.on("child-process-gone", (_event, details) => logger.log("ERROR", "electron", "Child process exited unexpectedly", details));
  const ipcMain = require("electron").ipcMain;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => originalOn(channel, (event, ...args) => {
    try {
      const result = listener(event, ...args);
      if (result && typeof result.then === "function") result.catch((error) => logger.log("ERROR", `ipc:${channel}`, "IPC event failed", error));
      return result;
    } catch (error) {
      logger.log("ERROR", `ipc:${channel}`, "IPC event failed", error);
      throw error;
    }
  });
  ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
    try { return await listener(event, ...args); }
    catch (error) { logger.log("ERROR", `ipc:${channel}`, "IPC request failed", error); throw error; }
  });
  const diagnosticsService = createDiagnosticsService({ app, logger, store, getMainWindow: () => mainWindow, trackingService: { getRunningGameCount: () => trackingService?.getRunningGameCount?.() ?? 0 } });
  ipcMain.on("renderer-log", (_event, entry) => {
    const level = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"].includes(entry?.level) ? entry.level : "ERROR";
    logger.log(level, "renderer", String(entry?.message || "Renderer message"), entry?.details);
  });

  function focusWindow(win) {
    if (!win || win.isDestroyed()) return false;

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();

    win.focus();
    win.moveTop();
    return true;
  }

  function focusExistingInstance() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      trayService.showLauncher();
      return;
    }
    focusWindow(splash);
  }

  app.on("second-instance", () => {
    focusExistingInstance();
  });

  const updateService = createGameUpdateService({ store });

  const trackingService = createGameTrackingService({
    store,
    getMainWindow,
    processService,
    systemActivityService,
  });

  appUpdateService = createAppUpdateService({
    autoUpdater,
    app,
    getMainWindow,
    logger,
    canInstallUpdate: () => trackingService.getRunningGameCount() === 0,
  });
  appUpdateService.setup();
  trayService = createTrayService({
    getMainWindow,
    checkForUpdates: () => appUpdateService.checkForUpdates(),
  });

  const launchService = createGameLaunchService({
    store,
    getMainWindow,
    detectionService,
    processService,
    trackingService,
    hideMainWindow: () => trayService.hideLauncher(),
  });

  const hostService = createHostService();

  registerIpcHandlers({
    ipcMain,
    appUpdateService,
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
    logger,
    diagnosticsService,
    ownerSession,
    websiteServiceClient,
    hideMainWindow: () => trayService.hideLauncher(),
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
      logger.log("INFO", "storage", "Application database initialized");
    } catch (err) {
      logger.log("FATAL", "storage", "Failed to initialize application database", err);
      console.error("Failed to initialize store:", err);
    }
    // 3. CREATE MAIN WINDOW HIDDEN
    mainWindow = createWindow({
      show: false,
    });
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) ownerSession.invalidate("navigation");
    });
    mainWindow.on("hide", () => ownerSession.invalidate("window-hidden"));
    powerMonitor.on("lock-screen", () => ownerSession.invalidate("windows-lock"));
    powerMonitor.on("suspend", () => ownerSession.invalidate("system-suspend"));
    mainWindow.webContents.on("render-process-gone", (_event, details) => logger.log("ERROR", "renderer", "Renderer process exited unexpectedly", details));
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) logger.log("ERROR", "renderer", "Page failed to load", { code, description, url });
    });
    mainWindow.webContents.on("console-message", (_event, details) => {
      if (details.level >= 2) logger.log(details.level >= 3 ? "ERROR" : "WARN", "renderer-console", details.message);
    });
    mainWindow.on("minimize", (event) => {
      event.preventDefault();
      trayService.hideLauncher();
    });
    trayService.create();
    // 4. WAIT UNTIL MAIN WINDOW IS READY
    mainWindow.once("ready-to-show", async () => {
      try {
        // 5. BACKGROUND BOOTSTRAP
        appUpdateService.checkForUpdates().catch((error) => {
          logger.log("ERROR", "updater", "Update check failed", error);
        });

        adminSocketService.connectSocketFromStore(store);
      } catch (err) {
        logger.log("ERROR", "startup", "Background bootstrap failed", err);
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
    logger.log("INFO", "app", "Application shutting down");
    systemActivityService.stop();
    trayService.destroy();
  });

  app.on("activate", () => {
    const { BrowserWindow } = require("electron");
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}

module.exports = { bootstrap };
