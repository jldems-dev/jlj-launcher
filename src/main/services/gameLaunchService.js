const fs = require('fs');
const path = require('path');
const os = require("os");
const { shell } = require('electron');
const { GAME_PATTERNS } = require('../config/gamePatterns');
const { exec, spawn } = require("child_process");
const runtimeState = require("./runtimeState");

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
    async function launchGame(gameId, launchMethod, appId, title) { 
      const game = store.findGame(gameId);
      if (!game) {
        console.error("Game not found:", gameId);
        return;
      }

      try {
        switch (launchMethod || game.launchMethod) {
          case "roblox":
            await launchRoblox(gameId);
            break;
          case "steam":
            launchSteam(appId || game.appId, gameId);
            break;
          case "epic":
            launchEpic(appId || game.appId, gameId);
            break;
          case "auto_detect":
            await launchAutoDetect(game, gameId);
            break;
          case "direct":
          default:
            if (game.exePath && fs.existsSync(game.exePath)) {
              launchDirect(game.exePath, gameId);
            } else if (
              game.detectedExePath &&
              fs.existsSync(game.detectedExePath)
            ) {
              launchDirect(game.detectedExePath, gameId);
            } else {
              await launchAutoDetect(game, gameId);
            }
            break;
        }

        runtimeState.currentGame = {
          id: game.id,
          title: game.title,
        };
      } catch (error) {
        console.error("Launch failed:", error);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("launch-failed", {
            gameId,
            error: error.message,
          });
        }
      }
    }
    async function launchGameAsHost(game) {
      if (!game.exePath) {
        throw new Error("Game executable missing");
      }

      const exe = game.exePath;
      let args = [];

      // LEFT 4 DEAD 2 HOST SUPPORT
      if (game.title.toLowerCase().includes("left 4 dead 2")) {
        const map = game.map || "c1m1_hotel";
        const username = game.playerName || "Player1";

        await setGoldbergUsername(username); // <-- Add await if async

        args = ["-console", "+sv_lan", "1", "+map", map, "+name", username];
      }

      const processName = path.basename(exe);

      trackingService.startProcessMonitor(game.gameId, processName, exe);

      spawn(exe, args, {
        detached: true,
        stdio: "ignore",
      }).unref();

      return {
        success: true,
      };
    }
    async function launchGameHostJoin(params) {
      if (!params) {
        throw new Error("Room is missing");
      }

      const game = store.findGame(params.host.gameId);

      if (!game) {
        throw new Error("Game not found in library");
      }

      if (!game.exePath) {
        throw new Error("Game executable missing");
      }

      let args = []; // <-- Declare args!

      // LEFT 4 DEAD 2 JOIN SUPPORT
      if (params.host.title.toLowerCase().includes("left 4 dead 2")) {
        const map = params.host.map || "c1m1_hotel";
        const username = params.host.playerName || "Player1";
        const connectUrl = `${params.ip}:${params.port}`; // <-- Use actual IP:port, not "url" string
        const gamePath = game.exePath;

        setGoldbergUsername(username);

        args = [
          "-console",
          "+connect",
          connectUrl, // <-- Fixed: use variable not string "url"
          "+map",
          map,
          "+name",
          username,
        ];

        const processName = path.basename(gamePath); // <-- Use gamePath not undefined exe

        trackingService.startProcessMonitor(game.gameId, processName, gamePath);

        spawn(gamePath, args, {
          detached: true,
          stdio: "ignore",
        }).unref(); 
        return {
          success: true,
          room: params,
        };
      }

      // Fallback for non-L4D2 games
      const processName = path.basename(game.exePath);

      trackingService.startProcessMonitor(
        game.gameId,
        processName,
        game.exePath,
      );

      spawn(game.exePath, [], {
        detached: true,
        stdio: "ignore",
      }).unref();

      return {
        success: true,
        room: params,
      };
    }
    async function setGoldbergUsername(username) {
      try {
        const savePath = path.join(
          os.homedir(),
          "AppData",
          "Roaming", 
          "Goldberg SteamEmu Saves",
          "settings",
        );

        if (!fs.existsSync(savePath)) {
          fs.mkdirSync(savePath, { recursive: true });
        }

        const accountFile = path.join(savePath, "account_name.txt");

        fs.writeFileSync(accountFile, username);

        console.log("Goldberg username updated:", username);
      } catch (err) {
        console.error("Failed to set Goldberg username:", err);
      }
    }

    return {
      launchDirect,
      launchRoblox,
      launchSteam,
      launchEpic,
      launchAutoDetect,
      launchGame,
      launchGameAsHost,
      launchGameHostJoin,
    };
}

module.exports = { createGameLaunchService };
