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

const { registerIpcHandlers } = require("./ipc/registerIpcHandlers");

function bootstrap() {
  let mainWindow;

  const getMainWindow = () => mainWindow;

  const store = createGameStore(app);

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
    getMainWindow,
  });

  app.whenReady().then(() => {
    store.init();
    mainWindow = createWindow();
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
