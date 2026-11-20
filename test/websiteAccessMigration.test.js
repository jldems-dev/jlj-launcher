const test = require("node:test");
const assert = require("node:assert/strict");
const initSqlJs = require("sql.js");
const {
  MIGRATIONS,
  migrationChecksum,
  getAppliedMigrations,
  applyWebsiteAccessMigrations,
} = require("../src/main/storage/websiteAccessMigrations");
const { createWebsiteAccessRepository } = require("../src/main/storage/websiteAccessRepository");
const { validateImportText, buildImportPreview } = require("../src/main/websiteAccess/importExport");

const DEPLOYED_V1_CHECKSUM = "6452a341132a9f7d61952ed12e7bd832f3281560221c096f566695ab10411da9";

async function makeDatabase() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return new SQL.Database();
}

function installV1(db, checksum = migrationChecksum(MIGRATIONS[0].sql)) {
  db.run(MIGRATIONS[0].sql);
  db.run("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (1, ?, ?)", ["2026-11-19T12:25:45.993Z", checksum]);
}

test("fresh database initializes all ordered migrations and inactive state", async () => {
  const db = await makeDatabase();
  assert.deepEqual(applyWebsiteAccessMigrations(db, () => "2026-01-01T00:00:00.000Z"), { version: 2 });
  assert.deepEqual(getAppliedMigrations(db).map((item) => item.version), [1, 2]);
  assert.equal(db.exec("SELECT enabled, mode, default_action, log_retention_days FROM website_access_settings WHERE id=1")[0].values[0].join("|"), "0|monitoring|deny|30");
  assert.equal(db.exec("SELECT state FROM website_service_status WHERE id=1")[0].values[0][0], "not_installed");
  assert.equal(db.exec("PRAGMA integrity_check")[0].values[0][0], "ok");
  db.close();
});

test("deployed version 1 is immutable and validates against its recorded checksum", async () => {
  assert.equal(migrationChecksum(MIGRATIONS[0].sql), DEPLOYED_V1_CHECKSUM);
  const db = await makeDatabase();
  installV1(db, DEPLOYED_V1_CHECKSUM);
  const original = db.exec("SELECT version, applied_at, checksum FROM schema_migrations WHERE version=1")[0].values[0];
  applyWebsiteAccessMigrations(db);
  const after = db.exec("SELECT version, applied_at, checksum FROM schema_migrations WHERE version=1")[0].values[0];
  assert.deepEqual(after, original);
  assert.deepEqual(getAppliedMigrations(db).map((item) => item.version), [1, 2]);
  db.close();
});

test("existing settings and rules survive v2 adding the missing retention column", async () => {
  const db = await makeDatabase();
  installV1(db, DEPLOYED_V1_CHECKSUM);
  db.run("UPDATE website_access_settings SET enabled=1, default_action='allow', policy_revision=17 WHERE id=1");
  db.run("INSERT INTO website_rules (domain_ascii, action, enabled, include_subdomains, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["keep.example", "block", 1, 1, "created", "updated"]);
  assert.equal(db.exec("PRAGMA table_info(website_access_settings)")[0].values.some((row) => row[1] === "log_retention_days"), false);

  applyWebsiteAccessMigrations(db);

  const settings = db.exec("SELECT enabled, default_action, policy_revision, log_retention_days FROM website_access_settings WHERE id=1")[0].values[0];
  assert.deepEqual(settings, [1, "allow", 17, 30]);
  assert.deepEqual(db.exec("SELECT domain_ascii, action FROM website_rules")[0].values[0], ["keep.example", "block"]);
  assert.equal(db.exec("PRAGMA integrity_check")[0].values[0][0], "ok");
  db.close();
});

test("rejects a tampered recorded checksum without changing migration history", async () => {
  const db = await makeDatabase();
  installV1(db, "0".repeat(64));
  const before = db.exec("SELECT version, applied_at, checksum FROM schema_migrations")[0].values;
  assert.throws(() => applyWebsiteAccessMigrations(db), /checksum mismatch at version 1/i);
  assert.deepEqual(db.exec("SELECT version, applied_at, checksum FROM schema_migrations")[0].values, before);
  assert.equal(db.exec("PRAGMA table_info(website_access_settings)")[0].values.some((row) => row[1] === "log_retention_days"), false);
  db.close();
});

test("repeated startup application does not duplicate migration records", async () => {
  const db = await makeDatabase();
  applyWebsiteAccessMigrations(db);
  applyWebsiteAccessMigrations(db);
  applyWebsiteAccessMigrations(db);
  assert.deepEqual(getAppliedMigrations(db).map((item) => item.version), [1, 2]);
  assert.equal(db.exec("SELECT COUNT(*) FROM website_access_settings")[0].values[0][0], 1);
  db.close();
});

test("migration failure rolls back v2 and a subsequent startup recovers", async () => {
  const db = await makeDatabase();
  installV1(db, DEPLOYED_V1_CHECKSUM);
  assert.throws(() => applyWebsiteAccessMigrations(db, () => { throw new Error("injected migration failure"); }), /injected migration failure/);
  assert.deepEqual(getAppliedMigrations(db).map((item) => item.version), [1]);
  assert.equal(db.exec("PRAGMA table_info(website_access_settings)")[0].values.some((row) => row[1] === "log_retention_days"), false);
  assert.deepEqual(applyWebsiteAccessMigrations(db), { version: 2 });
  assert.deepEqual(getAppliedMigrations(db).map((item) => item.version), [1, 2]);
  db.close();
});

test("repository refuses operations until the complete schema migration succeeds", async () => {
  const db = await makeDatabase();
  installV1(db, DEPLOYED_V1_CHECKSUM);
  let ready = false;
  const repository = createWebsiteAccessRepository({ getDatabase: () => db, persist: () => {}, isReady: () => ready });
  assert.throws(() => repository.getSettings(), /migrations are incomplete/i);
  applyWebsiteAccessMigrations(db);
  ready = true;
  assert.equal(repository.getSettings().logRetentionDays, 30);
  db.close();
});

test("stores normalized rules, rejects duplicates, and never reports enforcement active", async () => {
  const db = await makeDatabase();
  applyWebsiteAccessMigrations(db);
  const repository = createWebsiteAccessRepository({ getDatabase: () => db, persist: () => {} });
  const saved = repository.saveRule({ domain: "BÜCHER.de.", action: "allow", enabled: true, includeSubdomains: true });
  assert.equal(saved.domain, "xn--bcher-kva.de");
  assert.throws(() => repository.saveRule({ domain: "xn--bcher-kva.de", action: "block" }), /unique|constraint/i);
  assert.throws(() => repository.saveSettings({ enabled: true, mode: "enforcement", defaultAction: "deny", logRetentionDays: 30 }), /monitoring/i);
  assert.equal(repository.getStatus().service.state, "not_installed");
  assert.equal(repository.getStatus().enforcementImplemented, false);
  assert.equal(db.exec("SELECT COUNT(*) FROM website_access_log")[0].values[0][0], 0);
  db.close();
});

test("validates versioned JSON and builds add/update/skip/error preview", async () => {
  const text = JSON.stringify({
    format: "jlj-website-access", version: 1,
    settings: { enabled: false, mode: "monitoring", defaultAction: "deny", logRetentionDays: 30 },
    rules: [
      { domain: "new.example", action: "allow", enabled: true, includeSubdomains: false },
      { domain: "old.example", action: "block", enabled: true, includeSubdomains: false },
      { domain: "bad domain", action: "block" },
      { domain: "new.example.", action: "allow", enabled: true, includeSubdomains: false },
    ],
  });
  const validated = validateImportText(text);
  const preview = buildImportPreview(validated, [
    { id: 1, domain: "old.example", action: "allow", enabled: true, includeSubdomains: false },
  ]);
  assert.deepEqual(preview.counts, { add: 1, update: 1, skip: 1, error: 1 });
  assert.equal(preview.rules.length, 2);
  assert.throws(() => validateImportText(JSON.stringify({ format: "jlj-website-access", version: 2, rules: [] })), /unsupported/i);
  assert.throws(() => validateImportText(JSON.stringify({ format: "jlj-website-access", version: 1, rules: [], shell: "bad" })), /unsupported/i);
});
