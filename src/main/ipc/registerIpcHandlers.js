const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const { pathToFileURL } = require("node:url");
const { app, dialog, shell } = require('electron');
const systemActivityService = require("../services/systemActivityService");
const { manageDriveAccessPolicy } = require("../services/driveAccessPolicyService");
const { createChromeProtection, validateRequest } = require("../services/chromeProtectionService");
const { createDiscordService } = require("../services/discordService");

const execAsync = util.promisify(exec);
const allowedExternalUrls = new Set([
  "https://facebook.com",
  "https://youtube.com",
  "https://tiktok.com",
  "https://www.instagram.com/",
  "https://google.com",
]);

function registerIpcHandlers({
  ipcMain,
  appUpdateService,
  store,
  trackingService,
  launchService,
  detectionService,
  hostService,
  updateService,
  getMainWindow,
  hideMainWindow,
  cpService,
  popupWindowService,
  adminSocketService,
  logger,
}) {
  const discord = createDiscordService();
  const launcherUrl = pathToFileURL(path.join(app.getAppPath(), "index.html")).href;
  const chrome = createChromeProtection();
  const trackedOwnerWindows = new WeakSet();
  let ownerFrame;
  let loginAttempt = 0;
  function launcherRequest(operation) {
    return (event, ...args) => {
      const contents = getMainWindow()?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame?.url !== launcherUrl) {
        throw new Error("Requests are restricted to the launcher window.");
      }
      return operation(contents, event.senderFrame, ...args);
    };
  }

  ipcMain.handle("discord:status", launcherRequest(() => discord.status()));
  ipcMain.handle("discord:launch", launcherRequest(() => discord.launch()));
  ipcMain.handle("discord:install", launcherRequest((contents) => discord.install((progress) => {
    if (!contents.isDestroyed()) contents.send("discord:progress", progress);
  })));

  ipcMain.handle("app-update:get-state", () => appUpdateService.getState());
  ipcMain.handle("app-update:check", () => appUpdateService.checkForUpdates());
  ipcMain.handle("app-update:update", () => appUpdateService.updateApp());

  ipcMain.handle("check-for-updates", () => appUpdateService.checkForUpdates());

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

  ipcMain.handle("db-verify-owner", launcherRequest(async (contents, frame, username, password) => {
    const attempt = ++loginAttempt;
    ownerFrame = undefined;
    if (!trackedOwnerWindows.has(contents)) {
      trackedOwnerWindows.add(contents);
      contents.on("did-start-navigation", (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          ownerFrame = undefined;
          loginAttempt++;
        }
      });
    }
    const valid = await store.verifyOwner(username, password);
    if (!valid || attempt !== loginAttempt || contents.isDestroyed() || contents.mainFrame !== frame || frame.url !== launcherUrl) return false;
    ownerFrame = frame;
    return true;
  }));

  ipcMain.handle("owner:logout", launcherRequest(() => {
    ownerFrame = undefined;
    loginAttempt++;
  }));

  function ownerRequest(operation) {
    return launcherRequest((contents, frame, ...args) => {
      if (frame !== ownerFrame) throw new Error("Owner login required.");
      return operation(...args);
    });
  }

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
    if (allowedExternalUrls.has(url)) shell.openExternal(url);
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
    hideMainWindow();
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

  ipcMain.handle("cp:lock", ownerRequest(() => cpService.lockControlPanel()));
  ipcMain.handle("cp:unlock", ownerRequest(() => cpService.unlockControlPanel()));
  ipcMain.handle("cp:status", ownerRequest(() => cpService.getStatus()));
  ipcMain.handle("cp:open-control-panel", ownerRequest(() => cpService.openWindowsControlPanel()));
  ipcMain.handle("cp:drive-access", ownerRequest(manageDriveAccessPolicy));
  ipcMain.handle("cp:open-gpedit", ownerRequest(() => cpService.openLocalGroupPolicyEditor()));
  let confirmingChrome = false;
  ipcMain.handle("chrome:protection", launcherRequest(async (contents, frame, action, options) => {
    if (frame !== ownerFrame) throw new Error("Owner login required.");
    const request = validateRequest(action, options);
    if (confirmingChrome) throw new Error("A Chrome protection confirmation is already open.");
    if (action !== "enable") return chrome.run(action, request);

    const attempt = loginAttempt;
    confirmingChrome = true;
    try {
      const { response } = await dialog.showMessageBox(getMainWindow(), {
        type: "warning",
        title: "Enable Chrome Protection",
        message: "Enforce the audited AppLocker rules?",
        detail: "Confirm that you reviewed the audit events and tested the apps you need. The restrictions apply to everyone using this Windows account.",
        buttons: ["Cancel", "Enable Protection"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1) return { cancelled: true };
      if (attempt !== loginAttempt || frame !== ownerFrame || contents.isDestroyed() ||
          contents.mainFrame !== frame || frame.url !== launcherUrl) {
        throw new Error("Owner login required.");
      }
      return chrome.run(action, request);
    } finally {
      confirmingChrome = false;
    }
  }));
}

module.exports = { registerIpcHandlers };
