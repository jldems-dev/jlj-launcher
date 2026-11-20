"use strict";

const crypto = require("node:crypto");

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE TABLE website_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_ascii TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        include_subdomains INTEGER NOT NULL DEFAULT 0 CHECK (include_subdomains IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE website_access_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        mode TEXT NOT NULL DEFAULT 'monitoring' CHECK (mode IN ('monitoring', 'enforcement')),
        default_action TEXT NOT NULL DEFAULT 'deny' CHECK (default_action IN ('allow', 'deny')),
        policy_revision INTEGER NOT NULL DEFAULT 0 CHECK (policy_revision >= 0),
        last_sync_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE website_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_ascii TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE website_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        domain_ascii TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'block')),
        matched_rule_id INTEGER,
        policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0),
        source TEXT NOT NULL CHECK (source IN ('rule', 'default')),
        result_code TEXT NOT NULL DEFAULT 'observed'
      );
      CREATE INDEX website_access_log_time_idx ON website_access_log(occurred_at DESC, id DESC);
      CREATE INDEX website_access_log_domain_idx ON website_access_log(domain_ascii, occurred_at DESC);
      CREATE TABLE website_service_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL DEFAULT 'not_installed' CHECK (state IN ('not_installed', 'stopped', 'running', 'unavailable')),
        service_version TEXT,
        heartbeat_at TEXT,
        applied_revision INTEGER NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
        connection_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (connection_status IN ('not_configured', 'connected', 'disconnected')),
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO website_access_settings (id, enabled, mode, default_action, policy_revision, updated_at)
      VALUES (1, 0, 'monitoring', 'deny', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      INSERT INTO website_service_status (id, state, applied_revision, connection_status, updated_at)
      VALUES (1, 'not_installed', 0, 'not_configured', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE website_access_settings
        ADD COLUMN log_retention_days INTEGER NOT NULL DEFAULT 30
        CHECK (log_retention_days BETWEEN 1 AND 3650);
      CREATE INDEX IF NOT EXISTS website_rules_action_idx
        ON website_rules(action, domain_ascii COLLATE NOCASE);
    `,
  },
];

function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function tableExists(db, table) {
  const result = db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]);
  return !!result[0]?.values?.length;
}

function getAppliedMigrations(db) {
  if (!tableExists(db, "schema_migrations")) return [];
  const result = db.exec("SELECT version, checksum FROM schema_migrations ORDER BY version");
  return (result[0]?.values || []).map(([version, checksum]) => ({ version, checksum }));
}

function validateMigrationHistory(applied) {
  if (applied.some((entry, index) => !Number.isSafeInteger(entry.version) || entry.version !== index + 1)) {
    throw new Error("Website migration history is not sequential");
  }
  for (const entry of applied) {
    const migration = MIGRATIONS.find((item) => item.version === entry.version);
    if (!migration || migrationChecksum(migration.sql) !== entry.checksum) {
      throw new Error(`Website migration checksum mismatch at version ${entry.version}`);
    }
  }
}

function validateWebsiteSchema(db) {
  const required = {
    schema_migrations: ["version", "applied_at", "checksum"],
    website_rules: ["id", "domain_ascii", "action", "enabled", "include_subdomains", "created_at", "updated_at"],
    website_access_settings: ["id", "enabled", "mode", "default_action", "log_retention_days", "policy_revision", "last_sync_at", "updated_at"],
    website_exceptions: ["id", "domain_ascii", "reason", "enabled", "created_at", "updated_at"],
    website_access_log: ["id", "occurred_at", "domain_ascii", "decision", "matched_rule_id", "policy_revision", "source", "result_code"],
    website_service_status: ["id", "state", "service_version", "heartbeat_at", "applied_revision", "connection_status", "last_error", "updated_at"],
  };
  for (const [table, expectedColumns] of Object.entries(required)) {
    const result = db.exec(`PRAGMA table_info(${table})`)[0];
    const actual = new Set((result?.values || []).map((row) => row[1]));
    const missing = expectedColumns.filter((column) => !actual.has(column));
    if (missing.length) throw new Error(`Website Access Control schema is incomplete: ${table} is missing ${missing.join(", ")}`);
  }
}

function applyWebsiteAccessMigrations(db, now = () => new Date().toISOString()) {
  let applied = getAppliedMigrations(db);
  validateMigrationHistory(applied);
  let currentVersion = applied.at(-1)?.version || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    if (migration.version !== currentVersion + 1) throw new Error("Website migration sequence has a gap");
    db.run("BEGIN TRANSACTION");
    try {
      db.run(migration.sql);
      db.run("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)", [
        migration.version,
        now(),
        migrationChecksum(migration.sql),
      ]);
      db.run("COMMIT");
      currentVersion = migration.version;
      applied = getAppliedMigrations(db);
    } catch (error) {
      try { db.run("ROLLBACK"); } catch {}
      throw error;
    }
  }
  validateMigrationHistory(applied);
  validateWebsiteSchema(db);
  return { version: currentVersion };
}

module.exports = { MIGRATIONS, migrationChecksum, getAppliedMigrations, validateMigrationHistory, validateWebsiteSchema, applyWebsiteAccessMigrations };
