"use strict";

// Run with Electron, not Node: this uses the application store from an Electron main process.
// It applies only the normal store migrations, after the store creates and verifies its backup.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const initSqlJs = require("sql.js");
const { createGameStore } = require("../src/main/storage/gameStore");

// Optional isolated profile path used only by disposable-copy tests.
if (process.env.JLJ_WAC_SMOKE_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.JLJ_WAC_SMOKE_USER_DATA));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function tableRows(db, table, columns) {
  const selected = columns.map((column) => `"${column}"`).join(", ");
  return db.exec(`SELECT ${selected} FROM "${table}" ORDER BY rowid`)[0]?.values || [];
}

function databaseSnapshot(SQL, bytes) {
  const db = new SQL.Database(bytes, { readonly: true });
  try {
    const tableNames = ["owner", "games", "settings", "left4dead2_maps", "pc_specs", "website_rules", "website_access_settings", "website_exceptions", "website_access_log", "website_service_status"];
    const snapshot = {};
    for (const table of tableNames) {
      const columns = db.exec(`PRAGMA table_info("${table}")`)[0]?.values.map((row) => row[1]) || [];
      if (!columns.length) throw new Error(`Expected database table is missing: ${table}`);
      snapshot[table] = { columns, rows: tableRows(db, table, columns) };
    }
    const migration = db.exec("SELECT checksum FROM schema_migrations WHERE version = 1")[0]?.values?.[0]?.[0];
    const versions = db.exec("SELECT version FROM schema_migrations ORDER BY version")[0]?.values.map((row) => row[0]) || [];
    return { snapshot, migrationV1Checksum: migration, versions };
  } finally {
    db.close();
  }
}

async function run() {
  const expectedUserData = path.resolve(process.env.JLJ_WAC_SMOKE_USER_DATA || path.join(process.env.APPDATA || "", "jljgaminghouse"));
  const actualUserData = path.resolve(app.getPath("userData"));
  if (actualUserData.toLowerCase() !== expectedUserData.toLowerCase()) throw new Error("Electron user-data location did not match the expected JLJ profile; no migration was run");

  const dbPath = path.join(actualUserData, "database", "launcher.db");
  if (!fs.existsSync(dbPath)) throw new Error(`Expected runtime database is missing at ${dbPath}; no migration was run`);
  const beforeBytes = fs.readFileSync(dbPath);
  const beforeHash = sha256(beforeBytes);
  const priorBackups = new Set(fs.readdirSync(path.dirname(dbPath)).filter((name) => name.startsWith("launcher.db.pre-schema-v2-")));
  const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file) });
  const before = databaseSnapshot(SQL, beforeBytes);
  if (!before.migrationV1Checksum) throw new Error("Version 1 migration record is missing; no migration was run");
  if (JSON.stringify(before.versions) !== "[1]" && JSON.stringify(before.versions) !== "[1,2]") throw new Error("Unexpected Website Access Control migration history; no migration was run");
  const migrationPending = before.versions.length === 1;

  const store = createGameStore(app);
  await store.init();
  const afterBytes = fs.readFileSync(dbPath);
  const after = databaseSnapshot(SQL, afterBytes);
  const expectedSnapshot = migrationPending ? {
    ...before.snapshot,
    website_access_settings: {
      columns: [...before.snapshot.website_access_settings.columns, "log_retention_days"],
      rows: before.snapshot.website_access_settings.rows.map((row) => [...row, 30]),
    },
  } : before.snapshot;
  if (JSON.stringify(after.snapshot) !== JSON.stringify(expectedSnapshot)) {
    // Compare existing records separately below, excluding the one expected additive column.
    for (const table of Object.keys(before.snapshot)) {
      if (table === "website_access_settings") {
        const oldColumns = before.snapshot[table].columns;
        const afterColumns = after.snapshot[table].columns;
        const afterOldColumns = afterColumns.filter((column) => column !== "log_retention_days");
        if (JSON.stringify(afterOldColumns) !== JSON.stringify(oldColumns)) throw new Error("Website settings schema changed beyond the approved additive column");
        const oldPositions = oldColumns.map((column) => afterColumns.indexOf(column));
        const oldRowData = after.snapshot[table].rows.map((row) => oldPositions.map((position) => row[position]));
        if (JSON.stringify(oldRowData) !== JSON.stringify(before.snapshot[table].rows)) throw new Error("Existing website settings records changed during migration");
      } else if (JSON.stringify(after.snapshot[table]) !== JSON.stringify(before.snapshot[table])) {
        throw new Error(`Existing ${table} records or schema changed during migration`);
      }
    }
  }

  if (after.migrationV1Checksum !== before.migrationV1Checksum) throw new Error("Version 1 migration history was changed");
  const integrityDb = new SQL.Database(afterBytes, { readonly: true });
  const integrity = integrityDb.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
  const versions = integrityDb.exec("SELECT version FROM schema_migrations ORDER BY version")[0]?.values.map((row) => row[0]) || [];
  const retention = integrityDb.exec("SELECT log_retention_days FROM website_access_settings WHERE id=1")[0]?.values?.[0]?.[0];
  integrityDb.close();
  if (integrity !== "ok" || JSON.stringify(versions) !== "[1,2]" || retention !== 30) throw new Error("Post-migration schema or integrity validation failed");
  store.getWebsiteAccessSettings();

  const newBackups = fs.readdirSync(path.dirname(dbPath)).filter((name) => name.startsWith("launcher.db.pre-schema-v2-") && !priorBackups.has(name));
  if (migrationPending) {
    if (newBackups.length !== 1) throw new Error("Expected exactly one verified pre-migration backup");
    const backupBytes = fs.readFileSync(path.join(path.dirname(dbPath), newBackups[0]));
    if (sha256(backupBytes) !== beforeHash) throw new Error("Pre-migration backup is not byte-identical to the original database");
    const backupDb = new SQL.Database(backupBytes, { readonly: true });
    const backupIntegrity = backupDb.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
    backupDb.close();
    if (backupIntegrity !== "ok") throw new Error("Pre-migration backup integrity check failed");
  } else if (newBackups.length) {
    throw new Error("Unexpected schema backup created when no migration was pending");
  }

  process.stdout.write(`Electron main-process store startup: PASS; v1 checksum preserved; v2 ${migrationPending ? "applied" : "already current"}; existing records preserved; integrity=ok${migrationPending ? "; pre-migration backup byte-identical" : ""}.\n`);
}

app.whenReady().then(() => run()).then(() => {
  process.stdout.write("Electron main-process store startup completed successfully.\n", () => app.quit());
}).catch((error) => {
  process.stderr.write(`Electron main-process store startup failed; ${error.name}: ${error.message}\n`, () => app.exit(1));
});
