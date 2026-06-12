const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const { app, shell } = require('electron'); 
const systemActivityService = require("../services/systemActivityService");

const execAsync = util.promisify(exec);

function registerIpcHandlers({
  ipcMain,
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
}) {
  ipcMain.handle("check-for-updates", () => {
    autoUpdater.checkForUpdates();
  });

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("get-system-idle-state", () => {
    return systemActivityService.getState();
  });

  ipcMain.handle("db-get-games", () => {
    return store.getGames();
  });

  ipcMain.handle("db-get-left4dead2-maps", () => {
    return store.getLeft4Dead2Maps();
  });

  ipcMain.handle("db-get-pc-specs", () => {
    return store.getPcSpecs();
  });

  ipcMain.handle("db-save-pc-spec", (event, pcSpec, originalPcIp) => {
    return store.savePcSpec(pcSpec, originalPcIp);
  });

  ipcMain.handle("db-delete-pc-spec", (event, pcIp) => {
    return store.deletePcSpec(pcIp);
  });

  ipcMain.handle("db-get-storage-info", () => {
    return store.getStorageInfo();
  });

  ipcMain.handle("db-add-game", (event, game) => {
    const newGame = store.addGame(game);
    return { id: newGame.id, ...newGame };
  });

  ipcMain.handle("db-delete-game", (event, id) => {
    console.log("IPC db-delete-game:", id);
    trackingService.stopIfRunning(id);
    return store.deleteGame(id);
  });

  ipcMain.handle("db-update-game", (event, id, updates) => {
    console.log("IPC db-update-game:", id, updates);
    return store.updateGame(id, updates);
  });

  ipcMain.handle("db-verify-owner", (event, username, password) => {
    return store.verifyOwner(username, password);
  });

  ipcMain.handle("db-change-password", (event, currentPass, newPass) => {
    return store.changePassword(currentPass, newPass);
  });

  ipcMain.handle("db-get-gcash-number", () => {
    return store.getGcashNumber();
  });

  ipcMain.handle("db-update-gcash-number", (event, gcashNumber) => {
    return store.updateGcashNumber(gcashNumber);
  });

  ipcMain.handle("db-get-server-url", () => {
    return adminSocketService.getServerUrl(store);
  });

  ipcMain.handle("db-save-server-url", (event, serverUrl) => {
    return adminSocketService.saveServerUrl(store, serverUrl);
  });

  ipcMain.handle("db-delete-server-url", () => {
    return adminSocketService.deleteServerUrl(store);
  });

  ipcMain.handle("save-cover-image", (event, params) => {
    return store.saveCoverImage(params);
  });

  ipcMain.on(
    "launch-game",
    async (event, gameId, launchMethod, appId, title) => {
      await launchService.launchGame(gameId, launchMethod, appId, title);
    },
  );

  ipcMain.on("launch-game-as-host", async (event, game) => {
    await launchService.launchGameAsHost(game);
  });
  ipcMain.handle("launch-game-host-join", async (event, room) => {
    return await launchService.launchGameHostJoin(room);
  });

  ipcMain.on("stop-game", (event, gameId) => {
    trackingService.stopIfRunning(gameId);
  });

  ipcMain.handle("is-game-running", (event, gameId) => {
    return trackingService.isRunning(gameId);
  });

  ipcMain.handle("get-elapsed-time", (event, gameId) => {
    return trackingService.getElapsedTime(gameId);
  });

  ipcMain.handle("scan-for-games", async () => {
    return detectionService.scanForInstalledGames();
  });

  ipcMain.handle("check-game-updates", async () => {
    return await updateService.checkAllGames();
  });

  ipcMain.on("open-external", (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("open-multiple-roblox-instances", async () => {
    const exePath = path.join(
      app.getAppPath(),
      "instance",
      "Multiple ROBLOX.exe",
    );
    const error = await shell.openPath(exePath);

    if (error) {
      throw new Error(error);
    }

    return { success: true };
  });

  ipcMain.on("window-minimize", () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.on("window-maximize", () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle("pc:restart", async () => {
    await execAsync("shutdown /r /t 0");
    return { success: true };
  });

  ipcMain.handle("pc:shutdown", async () => {
    await execAsync("shutdown /s /t 0");
    return { success: true };
  });

  // Room hosting handlers
  ipcMain.handle("create-room", async (event, payload) => {
    return hostService.createRoom(payload);
  });

  ipcMain.handle("get-rooms", async () => {
    return hostService.getRooms();
  });

  ipcMain.handle("close-room", async (event, roomId) => {
    return hostService.closeRoom(roomId);
  });
  ipcMain.on("show-popup-window", (_, data) => {
    popupWindowService.showPopup(data);
  });

  // Control Panel
  ipcMain.handle("cp:lock", async () => {
    return cpService.lockControlPanel();
  });

  ipcMain.handle("cp:unlock", async () => {
    return cpService.unlockControlPanel();
  });

  ipcMain.handle("cp:status", async () => {
    return cpService.getStatus();
  });

  ipcMain.handle("cp:open-control-panel", async () => {
    return cpService.openWindowsControlPanel();
  });

  ipcMain.handle("cp:open-gpedit", async () => {
    return cpService.openLocalGroupPolicyEditor();
  });
}

module.exports = { registerIpcHandlers };
