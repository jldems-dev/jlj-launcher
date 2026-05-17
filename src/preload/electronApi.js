const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),

  launchGame: (gameId, launchMethod, appId, title) =>
    ipcRenderer.send("launch-game", gameId, launchMethod, appId, title),
  launchGameAsHost: (game) => ipcRenderer.send("launch-game-as-host", game),
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
  addGame: (game) => ipcRenderer.invoke("db-add-game", game),
  deleteGame: (id) => ipcRenderer.invoke("db-delete-game", id),
  updateGame: (id, updates) =>
    ipcRenderer.invoke("db-update-game", id, updates),
  verifyOwner: (username, password) =>
    ipcRenderer.invoke("db-verify-owner", username, password),
  changePassword: (currentPass, newPass) =>
    ipcRenderer.invoke("db-change-password", currentPass, newPass),
  getStorageInfo: () => ipcRenderer.invoke("db-get-storage-info"),

  openExternal: (url) => ipcRenderer.send("open-external", url),

  createRoom: (data) => ipcRenderer.invoke("create-room", data),
  getRooms: () => ipcRenderer.invoke("get-rooms"),
  closeRoom: (roomId) => ipcRenderer.invoke("close-room", roomId),
  checkGameUpdates: () => ipcRenderer.invoke("check-game-updates"),
});