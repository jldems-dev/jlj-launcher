const { shell } = require('electron'); 

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
  qosService, 
  cpService,
  popupWindowService,
}) {
  ipcMain.handle("check-for-updates", () => {
    autoUpdater.checkForUpdates();
  });

  ipcMain.on("restart-app", () => {
    let progress = 0;

    const installInterval = setInterval(() => {
      progress += 5;

      const mainWindow = getMainWindow();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("install-progress", {
          percent: progress,
        });
      }

      if (progress >= 100) {
        clearInterval(installInterval);

        setTimeout(() => {
          autoUpdater.quitAndInstall();
        }, 500);
      }
    }, 150);
  });

  ipcMain.handle("db-get-games", () => {
    return store.getGames();
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

  // ─── QoS / Brave Throttle ───
  ipcMain.handle("qos:apply", async (event, mbps) => {
    return qosService.applyThrottle(mbps);
  });

  ipcMain.handle("qos:remove", async () => {
    return qosService.removeThrottle();
  });

  ipcMain.handle("qos:status", async () => {
    return qosService.getStatus();
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
}

module.exports = { registerIpcHandlers };
