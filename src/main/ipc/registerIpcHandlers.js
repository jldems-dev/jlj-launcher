const { shell } = require('electron');

function registerIpcHandlers({ ipcMain, store, trackingService, launchService, detectionService, getMainWindow }) {
    ipcMain.handle('db-get-games', () => {
        return store.getGames();
    });

    ipcMain.handle('db-get-storage-info', () => {
        return store.getStorageInfo();
    });

    ipcMain.handle('db-add-game', (event, game) => {
        console.log('IPC db-add-game:', game.title);
        const newGame = store.addGame(game);
        return { id: newGame.id, ...newGame };
    });

    ipcMain.handle('db-delete-game', (event, id) => {
        console.log('IPC db-delete-game:', id);
        trackingService.stopIfRunning(id);
        return store.deleteGame(id);
    });

    ipcMain.handle('db-update-game', (event, id, updates) => {
        console.log('IPC db-update-game:', id, updates);
        return store.updateGame(id, updates);
    });

    ipcMain.handle('db-verify-owner', (event, username, password) => {
        return store.verifyOwner(username, password);
    });

    ipcMain.handle('db-change-password', (event, currentPass, newPass) => {
        return store.changePassword(currentPass, newPass);
    });

    ipcMain.on('launch-game', async (event, gameId, launchMethod, appId) => {
        await launchService.launchGame(gameId, launchMethod, appId);
    });

    ipcMain.on('stop-game', (event, gameId) => {
        trackingService.stopIfRunning(gameId);
    });

    ipcMain.handle('is-game-running', (event, gameId) => {
        return trackingService.isRunning(gameId);
    });

    ipcMain.handle('get-elapsed-time', (event, gameId) => {
        return trackingService.getElapsedTime(gameId);
    });

    ipcMain.handle('scan-for-games', async () => {
        return detectionService.scanForInstalledGames();
    });

    ipcMain.on('open-external', (event, url) => {
        shell.openExternal(url);
    });

    ipcMain.on('window-minimize', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });
    ipcMain.on('window-maximize', () => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
}

module.exports = { registerIpcHandlers };
