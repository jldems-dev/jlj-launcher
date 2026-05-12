const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    launchGame: (gameId, launchMethod, appId) => ipcRenderer.send('launch-game', gameId, launchMethod, appId),
    stopGame: (gameId) => ipcRenderer.send('stop-game', gameId),
    isGameRunning: (gameId) => ipcRenderer.invoke('is-game-running', gameId),
    getElapsedTime: (gameId) => ipcRenderer.invoke('get-elapsed-time', gameId),

    scanForGames: () => ipcRenderer.invoke('scan-for-games'),

    onGameStarted: (callback) => ipcRenderer.on('game-started', (_, data) => callback(data)),
    onGameStopped: (callback) => ipcRenderer.on('game-stopped', (_, data) => callback(data)),
    onLaunchFailed: (callback) => ipcRenderer.on('launch-failed', (_, data) => callback(data)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    getGames: () => ipcRenderer.invoke('db-get-games'),
    addGame: (game) => ipcRenderer.invoke('db-add-game', game),
    deleteGame: (id) => ipcRenderer.invoke('db-delete-game', id),
    updateGame: (id, updates) => ipcRenderer.invoke('db-update-game', id, updates),
    verifyOwner: (username, password) => ipcRenderer.invoke('db-verify-owner', username, password),
    changePassword: (currentPass, newPass) => ipcRenderer.invoke('db-change-password', currentPass, newPass),

    openExternal: (url) => ipcRenderer.send('open-external', url)
};

function exposeElectronApi() {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
}

module.exports = { exposeElectronApi, electronAPI };
