const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { GAME_PATTERNS } = require('../config/gamePatterns');

function createGameLaunchService({ store, getMainWindow, detectionService, processService, trackingService }) {
    function launchDirect(exePath, gameId) {
        const processName = path.basename(exePath);
        trackingService.startProcessMonitor(gameId, processName, exePath);
        shell.openPath(exePath);
    }

    async function launchRoblox(gameId) {
        const exePath = await detectionService.findRobloxExe();

        if (!exePath) {
            shell.openExternal('roblox://');

            setTimeout(async () => {
                let attempts = 0;
                const checkInterval = setInterval(async () => {
                    const running = await processService.isGameProcessRunning('roblox');
                    if (running) {
                        clearInterval(checkInterval);
                        const processName = await processService.findProcessByNames(GAME_PATTERNS.roblox.processNames);
                        if (processName) {
                            trackingService.startProcessMonitor(gameId, processName, exePath || 'RobloxPlayerBeta.exe');
                        }
                    }
                    attempts++;
                    if (attempts > 20) clearInterval(checkInterval);
                }, 3000);
            }, 5000);

            return;
        }

        const game = store.findGame(gameId);
        if (game) {
            game.detectedExePath = exePath;
            store.save();
        }

        launchDirect(exePath, gameId);
    }

    function launchSteam(appId, gameId) {
        const steamUrl = `steam://rungameid/${appId}`;
        shell.openExternal(steamUrl);

        showToast('Steam game launched. Timer will start when process detected.', 'info');

        setTimeout(async () => {
        }, 10000);
    }

    function launchEpic(appName, gameId) {
        const epicUrl = `com.epicgames.launcher://apps/${appName}?action=launch&silent=true`;
        shell.openExternal(epicUrl);
    }

    async function launchAutoDetect(game, gameId) {
        const titleLower = game.title.toLowerCase();
        let detectedMethod = 'direct';

        if (titleLower.includes('roblox')) detectedMethod = 'roblox';
        else if (titleLower.includes('bloodstrike')) detectedMethod = 'bloodstrike';
        else if (titleLower.includes('crossfire')) detectedMethod = 'crossfire';
        else if (titleLower.includes('minecraft')) detectedMethod = 'minecraft';

        const exePath = await detectionService.findGameExe(detectedMethod);

        if (exePath) {
            game.detectedExePath = exePath;
            game.launchMethod = detectedMethod;
            store.save();
            launchDirect(exePath, gameId);
        } else if (detectedMethod === 'roblox') {
            launchRoblox(gameId);
        } else {
            if (game.exePath && fs.existsSync(game.exePath)) {
                launchDirect(game.exePath, gameId);
            } else {
                throw new Error(`Could not find executable for ${game.title}`);
            }
        }
    }

    async function launchGame(gameId, launchMethod, appId) {
        const game = store.findGame(gameId);
        if (!game) {
            console.error('Game not found:', gameId);
            return;
        }

        try {
            switch (launchMethod || game.launchMethod) {
                case 'roblox':
                    await launchRoblox(gameId);
                    break;
                case 'steam':
                    launchSteam(appId || game.appId, gameId);
                    break;
                case 'epic':
                    launchEpic(appId || game.appId, gameId);
                    break;
                case 'auto_detect':
                    await launchAutoDetect(game, gameId);
                    break;
                case 'direct':
                default:
                    if (game.exePath && fs.existsSync(game.exePath)) {
                        launchDirect(game.exePath, gameId);
                    } else if (game.detectedExePath && fs.existsSync(game.detectedExePath)) {
                        launchDirect(game.detectedExePath, gameId);
                    } else {
                        await launchAutoDetect(game, gameId);
                    }
                    break;
            }
        } catch (error) {
            console.error('Launch failed:', error);
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launch-failed', { gameId, error: error.message });
            }
        }
    }

    return {
        launchDirect,
        launchRoblox,
        launchSteam,
        launchEpic,
        launchAutoDetect,
        launchGame
    };
}

module.exports = { createGameLaunchService };
