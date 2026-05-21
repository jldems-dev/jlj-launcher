const fs = require('fs');
const path = require('path');
const { OWNER_DEFAULTS, createDefaults } = require('./defaultData');

function normalizeGame(game) {
    if (game.id !== undefined && game.id !== null) {
        const numericId = Number(game.id);
        game.id = Number.isNaN(numericId) ? game.id : numericId;
    }
    if (game.totalMinutes === undefined) {
        const match = game.hours ? game.hours.match(/(\d+)h/) : null;
        game.totalMinutes = match ? parseInt(match[1]) * 60 : 0;
    }
    if (game.lastPlayedTimestamp === undefined) game.lastPlayedTimestamp = null;
    if (game.version === undefined) game.version = '1.0.0';
    if (game.latestVersion === undefined) game.latestVersion = '1.0.0';
    if (game.launchMethod === undefined) game.launchMethod = 'direct';
    if (game.HostSetup === undefined) game.HostSetup = 'no';
    if (game.appId === undefined) game.appId = '';
    if (game.detectedExePath === undefined) game.detectedExePath = '';
}

function normalizeLoadedData(rawData) {
    const normalizedData = Array.isArray(rawData)
        ? { games: rawData, owner: { ...OWNER_DEFAULTS } }
        : rawData;

    if (!Array.isArray(normalizedData.games)) normalizedData.games = [];
    if (!normalizedData.owner) normalizedData.owner = { ...OWNER_DEFAULTS };
    normalizedData.games.forEach(normalizeGame);

    return normalizedData;
}

function sameId(left, right) {
    return String(left) === String(right);
}

function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return normalizeLoadedData(JSON.parse(raw));
}

function createGameStore(app, rootDir = process.cwd()) {
  let dbPath;
  let data = { games: [], owner: { ...OWNER_DEFAULTS } };

  function init() {
    dbPath = path.join(rootDir, "jljgaminghouse.json");
    const legacyDbPath = path.join(
      app.getPath("userData"),
      "jljgaminghouse.json",
    );

    if (fs.existsSync(dbPath)) {
      try {
        data = readJsonFile(dbPath);
        if (data.games.length === 0 && fs.existsSync(legacyDbPath)) {
          const legacyData = readJsonFile(legacyDbPath);
          if (legacyData.games.length > 0) {
            data = legacyData;
          }
        }
      } catch (e) {
        console.error("Failed to parse JSON, creating new:", e);
        data = createDefaults();
      }
    } else if (fs.existsSync(legacyDbPath)) {
      try {
        data = readJsonFile(legacyDbPath);
      } catch (e) {
        console.error("Failed to parse legacy JSON, creating new:", e);
        data = createDefaults();
      }
    } else {
      data = createDefaults();
    }

    save();
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
      // console.log(`Saved game data to ${dbPath}`);
    } catch (e) {
      console.error("Failed to save JSON:", e);
      throw e;
    }
  }

  function getStorageInfo() {
    return {
      dbPath,
      gameCount: data.games.length,
    };
  }

  function getGames() {
    return data.games;
  }

  function findGame(gameId) {
    return data.games.find((g) => sameId(g.id, gameId));
  }

  function getNextId() {
    if (data.games.length === 0) return 1;
    const numericIds = data.games
      .map((g) => Number(g.id))
      .filter((id) => !Number.isNaN(id));
    if (numericIds.length === 0) return 1;
    return Math.max(...numericIds) + 1;
  }

  function saveCoverImage({ gameDir, fileName, data, ext }) {
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }

    const coverPath = path.join(gameDir, fileName);
    const buffer = Buffer.from(data, "base64");
    fs.writeFileSync(coverPath, buffer);

    return coverPath;
  }

  function addGame(game) {
    console.log("addGame called with:", game.title);
    const newGame = {
      id: getNextId(),
      title: game.title,
      cover: game.cover,
      genre: game.genre,
      hours: game.hours || "0h",
      totalMinutes: game.totalMinutes || 0,
      status: game.status || "installed",
      lastPlayed: game.lastPlayed || "Never",
      lastPlayedTimestamp: game.lastPlayedTimestamp || null,
      isFavorite: game.isFavorite || false,
      exePath: game.exePath || "",
      detectedExePath: game.detectedExePath || "",
      launchMethod: game.launchMethod || "direct",
      HostSetup: game.HostSetup || "no",
      appId: game.appId || "",
      version: game.version || "1.0.0",
      latestVersion: game.latestVersion || "1.0.0",
    };
    data.games.unshift(newGame);
    console.log("Saving games...");
    save();
    console.log("Games saved. Returning new game.");
    return newGame;
  }

  function deleteGame(id) {
    const beforeCount = data.games.length;
    data.games = data.games.filter((g) => !sameId(g.id, id));
    save();
    return data.games.length !== beforeCount;
  }

  function updateGame(id, updates) {
    const index = data.games.findIndex((g) => sameId(g.id, id));
    if (index !== -1) {
      data.games[index] = { ...data.games[index], ...updates };
      normalizeGame(data.games[index]);
      save();
      return true;
    }
    return false;
  }

  function verifyOwner(username, password) {
    return data.owner.username === username && data.owner.password === password;
  }

  function changePassword(currentPass, newPass) {
    if (data.owner.password === currentPass) {
      data.owner.password = newPass;
      save();
      return true;
    }
    return false;
  }

  // 👇 ADD HERE
  function setGameStatus(id, status) {
    return updateGame(id, { status });
  }

  function setGameVersion(id, version) {
    return updateGame(id, { version });
  }

  function setLatestVersion(id, latestVersion) {
    return updateGame(id, { latestVersion });
  }

  return {
    init,
    save,
    getGames,
    findGame,
    addGame,
    deleteGame,
    updateGame,
    saveCoverImage,

    // 👇 ADD THESE
    setGameStatus,
    setGameVersion,
    setLatestVersion,

    verifyOwner,
    changePassword,
    getStorageInfo,
  };
}

module.exports = { createGameStore };
