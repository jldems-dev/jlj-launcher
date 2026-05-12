const { formatHours } = require('./timeFormatter');

function createGameTrackingService({ store, getMainWindow, processService }) {
    const runningGames = new Map();

    function startProcessMonitor(gameId, processName, exePath) {
        const startTime = Date.now();

        runningGames.set(gameId, {
            processName,
            exePath,
            startTime,
            checkInterval: null
        });

        const checkInterval = setInterval(async () => {
            const running = await processService.isProcessRunning(processName);
            if (!running) {
                clearInterval(checkInterval);
                const gameData = runningGames.get(gameId);
                if (gameData) {
                    const elapsedMinutes = Math.floor((Date.now() - gameData.startTime) / 60000);
                    stopGameTracking(gameId, elapsedMinutes);
                }
            }
        }, 3000);

        runningGames.get(gameId).checkInterval = checkInterval;

        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game-started', { gameId, startTime });
        }
    }

    function stopGameTracking(gameId, elapsedMinutes) {
        const gameData = runningGames.get(gameId);
        if (!gameData) return;

        if (gameData.checkInterval) {
            clearInterval(gameData.checkInterval);
        }
        runningGames.delete(gameId);

        const game = store.findGame(gameId);
        if (!game) return;

        game.totalMinutes = (game.totalMinutes || 0) + elapsedMinutes;
        game.hours = formatHours(game.totalMinutes);
        game.lastPlayedTimestamp = Date.now();
        game.lastPlayed = 'Just now';

        store.save();

        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game-stopped', {
                gameId,
                elapsedMinutes,
                totalMinutes: game.totalMinutes,
                hours: game.hours
            });
        }
    }

    function stopIfRunning(gameId) {
        if (runningGames.has(gameId)) {
            const gameData = runningGames.get(gameId);
            const elapsedMinutes = Math.floor((Date.now() - gameData.startTime) / 60000);
            stopGameTracking(gameId, elapsedMinutes);
        }
    }

    function stopAll() {
        runningGames.forEach((gameData, gameId) => {
            const elapsedMinutes = Math.floor((Date.now() - gameData.startTime) / 60000);
            stopGameTracking(gameId, elapsedMinutes);
        });
    }

    function isRunning(gameId) {
        return runningGames.has(gameId);
    }

    function getElapsedTime(gameId) {
        if (!runningGames.has(gameId)) return 0;
        const gameData = runningGames.get(gameId);
        return Math.floor((Date.now() - gameData.startTime) / 1000);
    }

    return {
        startProcessMonitor,
        stopGameTracking,
        stopIfRunning,
        stopAll,
        isRunning,
        getElapsedTime
    };
}

module.exports = { createGameTrackingService };
