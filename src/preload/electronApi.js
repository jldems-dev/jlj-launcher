const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),

  onUpdateStatus: (cb) =>
    ipcRenderer.on("update-status", (_, data) => cb(data)),
  onUpdateProgress: (cb) =>
    ipcRenderer.on("update-progress", (_, data) => cb(data)),

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
  saveCoverImage: (params) => ipcRenderer.invoke("save-cover-image", params),
  addGame: (game) => ipcRenderer.invoke("db-add-game", game),
  deleteGame: (id) => ipcRenderer.invoke("db-delete-game", id),
  updateGame: (id, updates) =>
    ipcRenderer.invoke("db-update-game", id, updates),
  verifyOwner: (username, password) =>
    ipcRenderer.invoke("db-verify-owner", username, password),
  changePassword: (currentPass, newPass) =>
    ipcRenderer.invoke("db-change-password", currentPass, newPass),
  getStorageInfo: () => ipcRenderer.invoke("db-get-storage-info"),
  createRoom: (data) => ipcRenderer.invoke("create-room", data),
  getRooms: () => ipcRenderer.invoke("get-rooms"),
  closeRoom: (roomId) => ipcRenderer.invoke("close-room", roomId),
  checkGameUpdates: () => ipcRenderer.invoke("check-game-updates"),

  openExternal: (url) => ipcRenderer.send("open-external", url),
  restartApp: () => ipcRenderer.send("restart-app"),
  onInstallProgress: (callback) =>
    ipcRenderer.on("install-progress", (event, data) => callback(data)),

  // ─── QoS / Brave Throttle ───
  qosApply: (mbps) => ipcRenderer.invoke("qos:apply", mbps),
  qosRemove: () => ipcRenderer.invoke("qos:remove"),
  qosStatus: () => ipcRenderer.invoke("qos:status"),

  // ─── Control Panel ───
  lockControlPanel: () => ipcRenderer.invoke("cp:lock"),
  unlockControlPanel: () => ipcRenderer.invoke("cp:unlock"),
  getCpStatus: () => ipcRenderer.invoke("cp:status"),
});