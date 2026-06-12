const fs = require('fs');
const path = require('path');
const os = require("os");
const { shell } = require('electron');
const { GAME_PATTERNS } = require('../config/gamePatterns');
const { execFile, spawn } = require("child_process");
const runtimeState = require("./runtimeState");

function createGameLaunchService({ store, getMainWindow, detectionService, processService, trackingService }) {
    let steamStartupPromise = null;

    function minimizeMainWindow() {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    }

    async function launchDirect(exePath, gameId) {
        const processName = path.basename(exePath);
        const error = await shell.openPath(exePath);
        if (error) {
            throw new Error(error);
        }
        trackingService.startProcessMonitor(gameId, processName, exePath);
    }

    function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function querySteamRegistry(key) {
        return new Promise((resolve) => {
            execFile("reg", ["query", key, "/v", "SteamExe"], (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }

                const match = stdout.match(/SteamExe\s+REG_\w+\s+(.+)/i);
                const steamExe = match?.[1]
                    ?.trim()
                    .replace(/^"|"$/g, "")
                    .replace(/\//g, "\\");
                resolve(steamExe && fs.existsSync(steamExe) ? steamExe : null);
            });
        });
    }

    async function findSteamExe() {
        const configuredPath = GAME_PATTERNS.steam?.steamExe;
        const candidates = [
            configuredPath,
            process.env["ProgramFiles(x86)"] &&
                path.join(process.env["ProgramFiles(x86)"], "Steam", "steam.exe"),
            process.env.ProgramFiles &&
                path.join(process.env.ProgramFiles, "Steam", "steam.exe"),
        ].filter(Boolean);

        const installedPath = candidates.find((candidate) => fs.existsSync(candidate));
        if (installedPath) return installedPath;

        return (
            (await querySteamRegistry("HKCU\\Software\\Valve\\Steam")) ||
            (await querySteamRegistry("HKLM\\Software\\WOW6432Node\\Valve\\Steam"))
        );
    }

    async function isSteamRunning() {
        const processNames = GAME_PATTERNS.steam?.processNames || ["steam.exe"];

        for (const processName of processNames) {
            if (await processService.isProcessRunning(processName)) {
                return true;
            }
        }

        return false;
    }

    async function waitForSteamReady() {
        const steamConfig = GAME_PATTERNS.steam || {};
        const timeoutMs = steamConfig.startupTimeoutMs || 60000;
        const pollMs = steamConfig.readinessPollMs || 1000;
        const stablePollCount = steamConfig.stablePollCount || 3;
        const deadline = Date.now() + timeoutMs;
        let stablePolls = 0;

        while (Date.now() < deadline) {
            if (await isSteamRunning()) {
                stablePolls++;
                if (stablePolls >= stablePollCount) return;
            } else {
                stablePolls = 0;
            }

            await delay(pollMs);
        }

        throw new Error("Steam did not finish starting before the timeout");
    }

    async function ensureSteamRunning() {
        if (steamStartupPromise) return steamStartupPromise;
        if (await isSteamRunning()) return;

        steamStartupPromise = (async () => {
            const steamExe = await findSteamExe();
            if (!steamExe) {
                throw new Error("Steam installation could not be found");
            }

            const steamProcess = spawn(
                steamExe,
                GAME_PATTERNS.steam?.silentArgs || ["-silent"],
                {
                    detached: true,
                    stdio: "ignore",
                    windowsHide: true,
                },
            );

            await new Promise((resolve, reject) => {
                steamProcess.once("spawn", resolve);
                steamProcess.once("error", reject);
            });
            steamProcess.unref();

            await waitForSteamReady();
        })();

        try {
            await steamStartupPromise;
        } finally {
            steamStartupPromise = null;
        }
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

        await launchDirect(exePath, gameId);
    }
    async function launchSteam(game, gameId) {
        const exePath =
            game.exePath && fs.existsSync(game.exePath)
                ? game.exePath
                : game.detectedExePath && fs.existsSync(game.detectedExePath)
                  ? game.detectedExePath
                  : null;

        if (!exePath) {
            throw new Error(`Could not find executable for ${game.title}`);
        }

        await ensureSteamRunning();
        await launchDirect(exePath, gameId);
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
            await launchDirect(exePath, gameId);
        } else if (detectedMethod === 'roblox') {
            launchRoblox(gameId);
        } else {
            if (game.exePath && fs.existsSync(game.exePath)) {
                await launchDirect(game.exePath, gameId);
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
            await launchSteam(game, gameId);
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
              await launchDirect(game.exePath, gameId);
            } else if (
              game.detectedExePath &&
              fs.existsSync(game.detectedExePath)
            ) {
              await launchDirect(game.detectedExePath, gameId);
            } else {
              await launchAutoDetect(game, gameId);
            }
            break;
        }

        runtimeState.currentGame = {
          id: game.id,
          title: game.title,
        };
        minimizeMainWindow();
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

        args = [
          "-console",
          "-novid",
          "+sv_lan",
          "1",
          "+map",
          map,
          "+name",
          username,
        ];
      }

      const processName = path.basename(exe);

      trackingService.startProcessMonitor(game.gameId, processName, exe);

      spawn(exe, args, {
        detached: true,
        stdio: "ignore",
      }).unref();

      minimizeMainWindow();

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
        const username = params.host.playerName || "Player1";
        const connectUrl = `${params.host.localIP}`;
        const gamePath = game.exePath;

        setGoldbergUsername(username);

        args = [
          "-console",
          "-novid",
          "-insecure",
          "+connect",
          connectUrl,
        ];

        const processName = path.basename(gamePath); // <-- Use gamePath not undefined exe

        trackingService.startProcessMonitor(game.gameId, processName, gamePath); 
        spawn(gamePath, args, {
          detached: true,
          stdio: "ignore",
        }).unref(); 
        minimizeMainWindow();

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

      minimizeMainWindow();

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
