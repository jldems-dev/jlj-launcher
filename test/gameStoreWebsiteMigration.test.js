const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const initSqlJs = require("sql.js");
const { createGameStore } = require("../src/main/storage/gameStore");
const { MIGRATIONS, migrationChecksum } = require("../src/main/storage/websiteAccessMigrations");

async function makeSql() {
  return initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
}

function snapshot(db, table) {
  return db.exec(`SELECT * FROM "${table}"`)[0]?.values || [];
}

test("store backs up before v2, preserves existing rows, verifies integrity, and repeats cleanly", async () => {
  const SQL = await makeSql();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "JLJ-WAC-store-test-"));
  const userData = path.join(tempRoot, "user-data");
  const dbDir = path.join(userData, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "launcher.db");
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE owner (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL, gcash_number TEXT NOT NULL DEFAULT '');
    INSERT INTO owner VALUES (1, 'test-owner', 'fixture-password', '');
    CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, cover TEXT, genre TEXT, hours TEXT NOT NULL DEFAULT '0h', totalMinutes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'installed', lastPlayed TEXT NOT NULL DEFAULT 'Never', lastPlayedTimestamp INTEGER, isFavorite INTEGER NOT NULL DEFAULT 0, exePath TEXT, detectedExePath TEXT, launchMethod TEXT NOT NULL DEFAULT 'direct', HostSetup TEXT NOT NULL DEFAULT 'no', appId TEXT, version TEXT NOT NULL DEFAULT '1.0.0', latestVersion TEXT NOT NULL DEFAULT '1.0.0');
    INSERT INTO games (id, title) VALUES (7, 'Fixture Game');
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings VALUES ('fixture-key', 'fixture-value');
    CREATE TABLE left4dead2_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL UNIQUE, label TEXT NOT NULL, sortOrder INTEGER NOT NULL);
    INSERT INTO left4dead2_maps (value, label, sortOrder) VALUES ('map-a', 'Map A', 0);
    CREATE TABLE pc_specs (pcIp TEXT PRIMARY KEY, pcName TEXT NOT NULL DEFAULT '', windowsVersion TEXT NOT NULL DEFAULT '', ram TEXT NOT NULL DEFAULT '', ramUsage TEXT NOT NULL DEFAULT '', cpu TEXT NOT NULL DEFAULT '', gpu TEXT NOT NULL DEFAULT '', vram TEXT NOT NULL DEFAULT '', networkSpeed TEXT NOT NULL DEFAULT '', storage TEXT NOT NULL DEFAULT '', motherboard TEXT NOT NULL DEFAULT '', monitor TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', updatedAt TEXT NOT NULL DEFAULT '');
    INSERT INTO pc_specs (pcIp, pcName) VALUES ('192.0.2.5', 'Fixture PC');
  `);
  db.run(MIGRATIONS[0].sql);
  db.run("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (1, ?, ?)", ["2026-11-19T12:25:45.993Z", migrationChecksum(MIGRATIONS[0].sql)]);
  db.run("INSERT INTO website_rules (domain_ascii, action, enabled, include_subdomains, created_at, updated_at) VALUES ('preserve.example', 'block', 1, 1, 'created', 'updated')");
  const originalBytes = Buffer.from(db.export());
  fs.writeFileSync(dbPath, originalBytes);
  const beforeDb = new SQL.Database(originalBytes);
  const before = Object.fromEntries(["owner", "games", "settings", "left4dead2_maps", "pc_specs"].map((table) => [table, snapshot(beforeDb, table)]));
  const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex");
  beforeDb.close();

  const store = createGameStore({ getPath: () => userData }, path.join(tempRoot, "project-without-seed"));
  await store.init();

  const migratedDb = new SQL.Database(fs.readFileSync(dbPath));
  for (const table of Object.keys(before)) assert.deepEqual(snapshot(migratedDb, table), before[table], `${table} records changed during migration`);
  assert.equal(migratedDb.exec("SELECT log_retention_days FROM website_access_settings WHERE id=1")[0].values[0][0], 30);
  assert.equal(migratedDb.exec("SELECT domain_ascii FROM website_rules WHERE id=1")[0].values[0][0], "preserve.example");
  assert.equal(migratedDb.exec("PRAGMA integrity_check")[0].values[0][0], "ok");
  migratedDb.close();

  const backups = fs.readdirSync(dbDir).filter((name) => name.startsWith("launcher.db.pre-schema-v2-"));
  assert.equal(backups.length, 1);
  const backupBytes = fs.readFileSync(path.join(dbDir, backups[0]));
  assert.equal(crypto.createHash("sha256").update(backupBytes).digest("hex"), originalHash);
  const backupDb = new SQL.Database(backupBytes);
  assert.equal(backupDb.exec("PRAGMA integrity_check")[0].values[0][0], "ok");
  backupDb.close();

  await store.init();
  const repeatedDb = new SQL.Database(fs.readFileSync(dbPath));
  assert.deepEqual(repeatedDb.exec("SELECT version FROM schema_migrations ORDER BY version")[0].values, [[1], [2]]);
  assert.equal(repeatedDb.exec("SELECT COUNT(*) FROM website_access_settings")[0].values[0][0], 1);
  repeatedDb.close();
  assert.equal(fs.readdirSync(dbDir).filter((name) => name.startsWith("launcher.db.pre-schema-v2-")).length, 1);

  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  assert.ok(resolvedRoot.startsWith(resolvedTemp + path.sep));
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
});
