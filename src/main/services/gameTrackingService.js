const { formatHours } = require('./timeFormatter');
const { spawn } = require("child_process");

const PROCESS_MONITOR_INTERVAL_MS = 5000;

function createGameTrackingService({ store, getMainWindow, processService }) {
  const runningGames = new Map();
  let processMonitorInterval = null;
  let processMonitorRunning = false;

  function ensureProcessMonitor() {
    if (processMonitorInterval) return;
    processMonitorInterval = setInterval(checkRunningGames, PROCESS_MONITOR_INTERVAL_MS);
  }

  function stopProcessMonitorIfIdle() {
    if (runningGames.size > 0 || !processMonitorInterval) return;
    clearInterval(processMonitorInterval);
    processMonitorInterval = null;
  }

  async function checkRunningGames() {
    if (processMonitorRunning || runningGames.size === 0) return;
    processMonitorRunning = true;

    try {
      const processNames = [...new Set([...runningGames.values()].map((game) => game.processName))];
      const runningProcessNames = await processService.getRunningProcessNames(processNames);

      for (const [gameId, gameData] of [...runningGames.entries()]) {
        if (runningProcessNames.has(gameData.processName.toLowerCase())) continue;

        const elapsedMinutes = Math.floor((Date.now() - gameData.startTime) / 60000);
        stopGameTracking(gameId, elapsedMinutes);
      }
    } finally {
      processMonitorRunning = false;
      stopProcessMonitorIfIdle();
    }
  }

  function startProcessMonitor(gameId, processName, exePath) {
    const startTime = Date.now();

    runningGames.set(gameId, {
      processName,
      exePath,
      startTime,
    });

    ensureProcessMonitor();

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-started", { gameId, startTime });
    }
  }
  // Added: Kill the game process
  function killGameProcess(gameId) {
    const gameData = runningGames.get(gameId);
    if (!gameData) return;

    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/IM", gameData.processName, "/F", "/T"], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        spawn("pkill", ["-f", gameData.processName], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }
    } catch (err) {
      console.error(`Failed to kill process ${gameData.processName}:`, err);
    }
  }

  function stopGameTracking(gameId, elapsedMinutes) {
    const gameData = runningGames.get(gameId);
    if (!gameData) return;

    runningGames.delete(gameId);
    stopProcessMonitorIfIdle();

    const game = store.findGame(gameId);
    if (!game) return;

    game.totalMinutes = (game.totalMinutes || 0) + elapsedMinutes;
    game.hours = formatHours(game.totalMinutes);
    game.lastPlayedTimestamp = Date.now();
    game.lastPlayed = "Just now";

    store.save();

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-stopped", {
        gameId,
        elapsedMinutes,
        totalMinutes: game.totalMinutes,
        hours: game.hours,
      });
    }
  }

  function stopIfRunning(gameId) {
    if (runningGames.has(gameId)) {
      killGameProcess(gameId); // Added
      const gameData = runningGames.get(gameId);
      const elapsedMinutes = Math.floor(
        (Date.now() - gameData.startTime) / 60000,
      );
      stopGameTracking(gameId, elapsedMinutes);
    }
  }

  function stopAll() {
    [...runningGames.entries()].forEach(([gameId, gameData]) => {
      killGameProcess(gameId); // Added
      const elapsedMinutes = Math.floor(
        (Date.now() - gameData.startTime) / 60000,
      );
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
    getElapsedTime,
  };
}

module.exports = { createGameTrackingService };
