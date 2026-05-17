const fs = require("fs");
const path = require("path");
const axios = require("axios");

function getInstalledRobloxVersion(game) {
  try {
    const basePath = game.exePath || game.detectedExePath;

    if (!basePath) return null;

    const robloxVersionsPath = path.join(
      path.dirname(path.dirname(basePath)),
      "Versions",
    );

    if (!fs.existsSync(robloxVersionsPath)) {
      return null;
    }

    const folders = fs
      .readdirSync(robloxVersionsPath)
      .filter((f) => f.startsWith("version-"));

    if (!folders.length) return null;

    return folders.sort().pop();
  } catch {
    return null;
  }
}

async function getLatestRobloxVersion() {
  try {
    const res = await axios.get(
      "https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer",
      {
        timeout: 10000,
      },
    );

    return res.data.clientVersionUpload;
  } catch {
    return null;
  }
}

module.exports = async function checkRoblox(game) {
  try {
    const localVersion = getInstalledRobloxVersion(game);

    if (!localVersion) {
      return {
        game: "Roblox",
        status: "installed",
      };
    }

    const latestVersion = await getLatestRobloxVersion();

    if (!latestVersion) {
      return {
        game: "Roblox",
        version: localVersion,
        latestVersion: "UNKNOWN",
        status: "ERROR",
      };
    }

    const updated = localVersion.includes(latestVersion);

    return {
      game: "Roblox",
      version: localVersion,
      latestVersion,
      status: updated ? "installed" : "update",
    };
  } catch {
    return {
      game: "Roblox",
      status: "ERROR",
    };
  }
};
