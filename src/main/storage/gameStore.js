const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const { OWNER_DEFAULTS, createDefaults } = require("./defaultData");
const { LEFT4DEAD2_MAPS } = require("./defaultMaps");

const GAME_COLUMNS = [
  "id",
  "title",
  "cover",
  "genre",
  "hours",
  "totalMinutes",
  "status",
  "lastPlayed",
  "lastPlayedTimestamp",
  "isFavorite",
  "exePath",
  "detectedExePath",
  "launchMethod",
  "HostSetup",
  "appId",
  "version",
  "latestVersion",
];

const UPDATE_COLUMNS = new Set(GAME_COLUMNS.filter((column) => column !== "id"));

const PC_SPEC_COLUMNS = [
  "pcIp",
  "pcName",
  "windowsVersion",
  "ram",
  "ramUsage",
  "cpu",
  "gpu",
  "vram",
  "networkSpeed",
  "storage",
  "motherboard",
  "monitor",
  "notes",
  "updatedAt",
];

function normalizeGame(game) {
  if (game.id !== undefined && game.id !== null) {
    const numericId = Number(game.id);
    game.id = Number.isNaN(numericId) ? game.id : numericId;
  }
  if (game.totalMinutes === undefined || game.totalMinutes === null) {
    const match = game.hours ? game.hours.match(/(\d+)h/) : null;
    game.totalMinutes = match ? parseInt(match[1], 10) * 60 : 0;
  }
  if (game.lastPlayedTimestamp === undefined) game.lastPlayedTimestamp = null;
  if (game.version === undefined) game.version = "1.0.0";
  if (game.latestVersion === undefined) game.latestVersion = "1.0.0";
  if (game.launchMethod === undefined) game.launchMethod = "direct";
  if (game.HostSetup === undefined) game.HostSetup = "no";
  if (game.appId === undefined) game.appId = "";
  if (game.detectedExePath === undefined) game.detectedExePath = "";
  if (game.hours === undefined) game.hours = "0h";
  if (game.status === undefined) game.status = "installed";
  if (game.lastPlayed === undefined) game.lastPlayed = "Never";
  game.isFavorite = Boolean(game.isFavorite);
}

function sameId(left, right) {
  return String(left) === String(right);
}

function sqliteValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function rowToGame(row) {
  const game = { ...row, isFavorite: Boolean(row.isFavorite) };
  normalizeGame(game);
  return game;
}

function normalizePcSpec(pcSpec) {
  const normalized = {};
  PC_SPEC_COLUMNS.forEach((column) => {
    normalized[column] = String(pcSpec?.[column] || "").trim();
  });
  normalized.updatedAt = normalized.updatedAt || new Date().toISOString();
  return normalized;
}

function createGameStore(app, rootDir = process.cwd()) {
  let dbPath;
  let db;
  let data = createDefaults();

  async function init() {
    dbPath = path.join(rootDir, "database", "launcher.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const SQL = await initSqlJs({
      locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file),
    });

    if (fs.existsSync(dbPath)) {
      db = new SQL.Database(fs.readFileSync(dbPath));
    } else {
      db = new SQL.Database();
    }

    createSchema();
    ensureOwner();
    ensureLeft4Dead2Maps();
    loadData();
    persist();
  }

  function createSchema() {
    db.run(`
      CREATE TABLE IF NOT EXISTS owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        gcash_number TEXT NOT NULL DEFAULT ''
      );
    `);

    ensureColumn("owner", "gcash_number", "TEXT NOT NULL DEFAULT ''");

    db.run(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        cover TEXT,
        genre TEXT,
        hours TEXT NOT NULL DEFAULT '0h',
        totalMinutes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'installed',
        lastPlayed TEXT NOT NULL DEFAULT 'Never',
        lastPlayedTimestamp INTEGER,
        isFavorite INTEGER NOT NULL DEFAULT 0,
        exePath TEXT,
        detectedExePath TEXT,
        launchMethod TEXT NOT NULL DEFAULT 'direct',
        HostSetup TEXT NOT NULL DEFAULT 'no',
        appId TEXT,
        version TEXT NOT NULL DEFAULT '1.0.0',
        latestVersion TEXT NOT NULL DEFAULT '1.0.0'
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS left4dead2_maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        sortOrder INTEGER NOT NULL
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS pc_specs (
        pcIp TEXT PRIMARY KEY,
        pcName TEXT NOT NULL DEFAULT '',
        windowsVersion TEXT NOT NULL DEFAULT '',
        ram TEXT NOT NULL DEFAULT '',
        ramUsage TEXT NOT NULL DEFAULT '',
        cpu TEXT NOT NULL DEFAULT '',
        gpu TEXT NOT NULL DEFAULT '',
        vram TEXT NOT NULL DEFAULT '',
        networkSpeed TEXT NOT NULL DEFAULT '',
        storage TEXT NOT NULL DEFAULT '',
        motherboard TEXT NOT NULL DEFAULT '',
        monitor TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL DEFAULT ''
      );
    `);

    [
      ["pcName", "TEXT NOT NULL DEFAULT ''"],
      ["windowsVersion", "TEXT NOT NULL DEFAULT ''"],
      ["ram", "TEXT NOT NULL DEFAULT ''"],
      ["ramUsage", "TEXT NOT NULL DEFAULT ''"],
      ["cpu", "TEXT NOT NULL DEFAULT ''"],
      ["gpu", "TEXT NOT NULL DEFAULT ''"],
      ["vram", "TEXT NOT NULL DEFAULT ''"],
      ["networkSpeed", "TEXT NOT NULL DEFAULT ''"],
      ["storage", "TEXT NOT NULL DEFAULT ''"],
      ["motherboard", "TEXT NOT NULL DEFAULT ''"],
      ["monitor", "TEXT NOT NULL DEFAULT ''"],
      ["notes", "TEXT NOT NULL DEFAULT ''"],
      ["updatedAt", "TEXT NOT NULL DEFAULT ''"],
    ].forEach(([column, definition]) => {
      ensureColumn("pc_specs", column, definition);
    });
  }

  function ensureOwner() {
    const result = db.exec("SELECT COUNT(*) AS count FROM owner;");
    const count = result[0]?.values[0]?.[0] || 0;
    if (count === 0) {
      db.run(
        "INSERT INTO owner (id, username, password, gcash_number) VALUES (1, ?, ?, ?);",
        [
          OWNER_DEFAULTS.username,
          OWNER_DEFAULTS.password,
          OWNER_DEFAULTS.gcash_number,
        ],
      );
    }
  }

  function ensureColumn(tableName, columnName, definition) {
    const result = db.exec(`PRAGMA table_info(${tableName});`);
    const columns = result[0]?.values.map((value) => value[1]) || [];
    if (!columns.includes(columnName)) {
      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
  }

  function ensureLeft4Dead2Maps() {
    const result = db.exec("SELECT COUNT(*) AS count FROM left4dead2_maps;");
    const count = result[0]?.values[0]?.[0] || 0;
    if (count > 0) return;

    db.run("BEGIN TRANSACTION;");
    try {
      LEFT4DEAD2_MAPS.forEach((map, index) => {
        db.run(
          "INSERT INTO left4dead2_maps (value, label, sortOrder) VALUES (?, ?, ?);",
          [map.value, map.label, index],
        );
      });
      db.run("COMMIT;");
    } catch (error) {
      db.run("ROLLBACK;");
      throw error;
    }
  }

  function loadData() {
    data = createDefaults();

    const ownerResult = db.exec(
      "SELECT username, password, gcash_number FROM owner WHERE id = 1;",
    );
    if (ownerResult[0]?.values[0]) {
      const [username, password, gcashNumber] = ownerResult[0].values[0];
      data.owner = { username, password, gcash_number: gcashNumber || "" };
    }

    const gamesResult = db.exec(`SELECT ${GAME_COLUMNS.join(", ")} FROM games ORDER BY id DESC;`);
    if (gamesResult[0]) {
      const columns = gamesResult[0].columns;
      data.games = gamesResult[0].values.map((values) => {
        const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
        return rowToGame(row);
      });
    }
  }

  function persist() {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function save() {
    db.run("BEGIN TRANSACTION;");
    try {
      db.run("DELETE FROM games;");
      for (const game of data.games) {
        normalizeGame(game);
        db.run(
          `
            INSERT OR REPLACE INTO games (
              id, title, cover, genre, hours, totalMinutes, status, lastPlayed,
              lastPlayedTimestamp, isFavorite, exePath, detectedExePath,
              launchMethod, HostSetup, appId, version, latestVersion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `,
          GAME_COLUMNS.map((column) => sqliteValue(game[column])),
        );
      }

      db.run(
        "INSERT OR REPLACE INTO owner (id, username, password, gcash_number) VALUES (1, ?, ?, ?);",
        [
          data.owner.username,
          data.owner.password,
          data.owner.gcash_number || "",
        ],
      );
      db.run("COMMIT;");
      persist();
    } catch (error) {
      db.run("ROLLBACK;");
      console.error("Failed to save SQLite database:", error);
      throw error;
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

  function getLeft4Dead2Maps() {
    const result = db.exec(
      "SELECT value, label FROM left4dead2_maps ORDER BY sortOrder ASC, id ASC;",
    );
    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map((values) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index]])),
    );
  }

  function getPcSpecs() {
    const result = db.exec(
      `SELECT ${PC_SPEC_COLUMNS.join(", ")} FROM pc_specs ORDER BY pcName COLLATE NOCASE ASC, pcIp ASC;`,
    );
    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map((values) =>
      normalizePcSpec(
        Object.fromEntries(columns.map((column, index) => [column, values[index]])),
      ),
    );
  }

  function savePcSpec(pcSpec, originalPcIp = "") {
    const normalized = normalizePcSpec({
      ...pcSpec,
      updatedAt: new Date().toISOString(),
    });
    if (!normalized.pcIp) {
      throw new Error("PC IP is required");
    }

    if (originalPcIp && originalPcIp !== normalized.pcIp) {
      db.run("DELETE FROM pc_specs WHERE pcIp = ?;", [originalPcIp]);
    }

    db.run(
      `
        INSERT OR REPLACE INTO pc_specs (
          pcIp, pcName, windowsVersion, ram, ramUsage, cpu, gpu, vram,
          networkSpeed, storage, motherboard, monitor, notes, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      PC_SPEC_COLUMNS.map((column) => normalized[column]),
    );
    persist();
    return normalized;
  }

  function deletePcSpec(pcIp) {
    const value = String(pcIp || "").trim();
    if (!value) return false;

    db.run("DELETE FROM pc_specs WHERE pcIp = ?;", [value]);
    persist();
    return true;
  }

  function findGame(gameId) {
    return data.games.find((game) => sameId(game.id, gameId));
  }

  function getNextId() {
    if (data.games.length === 0) return 1;
    const numericIds = data.games
      .map((game) => Number(game.id))
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
    normalizeGame(newGame);
    data.games.unshift(newGame);
    save();
    return newGame;
  }

  function deleteGame(id) {
    const beforeCount = data.games.length;
    data.games = data.games.filter((game) => !sameId(game.id, id));
    save();
    return data.games.length !== beforeCount;
  }

  function updateGame(id, updates) {
    const index = data.games.findIndex((game) => sameId(game.id, id));
    if (index === -1) return false;

    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => UPDATE_COLUMNS.has(key)),
    );
    data.games[index] = { ...data.games[index], ...safeUpdates };
    normalizeGame(data.games[index]);
    save();
    return true;
  }

  function verifyOwner(username, password) {
    return data.owner.username === username && data.owner.password === password;
  }

  function changePassword(currentPass, newPass) {
    if (data.owner.password !== currentPass) return false;
    data.owner.password = newPass;
    save();
    return true;
  }

  function getGcashNumber() {
    return data.owner.gcash_number || "";
  }

  function updateGcashNumber(gcashNumber) {
    data.owner.gcash_number = String(gcashNumber || "").trim();
    db.run("UPDATE owner SET gcash_number = ? WHERE id = 1;", [
      data.owner.gcash_number,
    ]);
    persist();
    return data.owner.gcash_number;
  }

  function setGameStatus(id, status) {
    return updateGame(id, { status });
  }

  function setGameVersion(id, version) {
    return updateGame(id, { version });
  }

  function setLatestVersion(id, latestVersion) {
    return updateGame(id, { latestVersion });
  }

  function getSetting(key) {
    const statement = db.prepare("SELECT value FROM settings WHERE key = ?;");
    try {
      statement.bind([key]);
      return statement.step() ? statement.getAsObject().value : null;
    } finally {
      statement.free();
    }
  }

  function setSetting(key, value) {
    db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);",
      [key, value === undefined || value === null ? null : String(value)],
    );
    persist();
  }

  return {
    init,
    save,
    getGames,
    getLeft4Dead2Maps,
    getPcSpecs,
    savePcSpec,
    deletePcSpec,
    findGame,
    addGame,
    deleteGame,
    updateGame,
    saveCoverImage,
    setGameStatus,
    setGameVersion,
    setLatestVersion,
    getSetting,
    setSetting,
    verifyOwner,
    changePassword,
    getGcashNumber,
    updateGcashNumber,
    getStorageInfo,
  };
}

module.exports = { createGameStore };
