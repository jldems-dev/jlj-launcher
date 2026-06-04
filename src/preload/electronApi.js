const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  restartPc: () => ipcRenderer.invoke("pc:restart"),
  shutdownPc: () => ipcRenderer.invoke("pc:shutdown"),

  onUpdateStatus: (cb) =>
    ipcRenderer.on("update-status", (_, data) => cb(data)),
  onUpdateProgress: (cb) =>
    ipcRenderer.on("update-progress", (_, data) => cb(data)),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  launchGame: (gameId, launchMethod, appId, title) =>
    ipcRenderer.send("launch-game", gameId, launchMethod, appId, title),
  launchGameAsHost: (data) => ipcRenderer.send("launch-game-as-host", data),
  launchGameHostJoin: (room) =>
    ipcRenderer.invoke("launch-game-host-join", room),
  stopGame: (gameId) => ipcRenderer.send("stop-game", gameId),
  isGameRunning: (gameId) => ipcRenderer.invoke("is-game-running", gameId),
  getElapsedTime: (gameId) => ipcRenderer.invoke("get-elapsed-time", gameId),

  scanForGames: () => ipcRenderer.invoke("scan-for-games"),

  onGameStarted: (callback) =>
    ipcRenderer.on("game-started", (_, data) => callback(data)),
  onGameStopped: (callback) =>
    ipcRenderer.on("game-stopped", (_, data) => callback(data)),
  onLaunchFailed: (callback) =>
    ipcRenderer.on("launch-failed", (_, data) => callback(data)),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  getGames: () => ipcRenderer.invoke("db-get-games"),
  getLeft4Dead2Maps: () => ipcRenderer.invoke("db-get-left4dead2-maps"),
  getPcSpecs: () => ipcRenderer.invoke("db-get-pc-specs"),
  savePcSpec: (pcSpec, originalPcIp) =>
    ipcRenderer.invoke("db-save-pc-spec", pcSpec, originalPcIp),
  deletePcSpec: (pcIp) => ipcRenderer.invoke("db-delete-pc-spec", pcIp),
  saveCoverImage: (params) => ipcRenderer.invoke("save-cover-image", params),
  addGame: (game) => ipcRenderer.invoke("db-add-game", game),
  deleteGame: (id) => ipcRenderer.invoke("db-delete-game", id),
  updateGame: (id, updates) =>
    ipcRenderer.invoke("db-update-game", id, updates),
  verifyOwner: (username, password) =>
    ipcRenderer.invoke("db-verify-owner", username, password),
  changePassword: (currentPass, newPass) =>
    ipcRenderer.invoke("db-change-password", currentPass, newPass),
  getGcashNumber: () => ipcRenderer.invoke("db-get-gcash-number"),
  updateGcashNumber: (gcashNumber) =>
    ipcRenderer.invoke("db-update-gcash-number", gcashNumber),
  getServerUrl: () => ipcRenderer.invoke("db-get-server-url"),
  saveServerUrl: (serverUrl) =>
    ipcRenderer.invoke("db-save-server-url", serverUrl),
  deleteServerUrl: () => ipcRenderer.invoke("db-delete-server-url"),
  getStorageInfo: () => ipcRenderer.invoke("db-get-storage-info"),
  createRoom: (data) => ipcRenderer.invoke("create-room", data),
  getRooms: () => ipcRenderer.invoke("get-rooms"),
  closeRoom: (roomId) => ipcRenderer.invoke("close-room", roomId),
  checkGameUpdates: () => ipcRenderer.invoke("check-game-updates"),

  openExternal: (url) => ipcRenderer.send("open-external", url),
  openMultipleRobloxInstances: () =>
    ipcRenderer.invoke("open-multiple-roblox-instances"),
  onInstallProgress: (callback) =>
    ipcRenderer.on("install-progress", (event, data) => callback(data)),
  lockControlPanel: () => ipcRenderer.invoke("cp:lock"),
  unlockControlPanel: () => ipcRenderer.invoke("cp:unlock"),
  getCpStatus: () => ipcRenderer.invoke("cp:status"),
  openWindowsControlPanel: () => ipcRenderer.invoke("cp:open-control-panel"),
  openLocalGroupPolicyEditor: () => ipcRenderer.invoke("cp:open-gpedit"),
});
