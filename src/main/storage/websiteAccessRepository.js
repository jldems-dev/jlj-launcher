"use strict";

const { normalizeRule } = require("../websiteAccess/domainRules");

function createWebsiteAccessRepository({ getDatabase, persist, isReady = () => true, now = () => new Date().toISOString() }) {
  const db = () => {
    if (!isReady()) throw new Error("Website Access Control schema migrations are incomplete");
    const value = getDatabase();
    if (!value) throw new Error("Database is not initialized");
    return value;
  };

  function query(sql, params = []) {
    const statement = db().prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  function writeRevision() {
    db().run("UPDATE website_access_settings SET policy_revision = policy_revision + 1, updated_at = ? WHERE id = 1", [now()]);
  }

  function transaction(work) {
    db().run("BEGIN TRANSACTION");
    try {
      const result = work();
      db().run("COMMIT");
      persist();
      return result;
    } catch (error) {
      try { db().run("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function mapRule(row) {
    return {
      id: Number(row.id), domain: row.domain_ascii, action: row.action,
      enabled: row.enabled === 1, includeSubdomains: row.include_subdomains === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function listRules({ action, search = "", enabled } = {}) {
    if (action !== undefined && !["allow", "block"].includes(action)) throw new Error("Invalid rule action filter");
    if (typeof search !== "string" || search.length > 253) throw new Error("Search text is too long");
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("Enabled filter is invalid");
    const clauses = [];
    const params = [];
    if (action) { clauses.push("action = ?"); params.push(action); }
    if (search.trim()) { clauses.push("domain_ascii LIKE ? ESCAPE '\\'"); params.push(`%${search.trim().replace(/[\\%_]/g, "\\$&")}%`); }
    if (enabled !== undefined) { clauses.push("enabled = ?"); params.push(enabled ? 1 : 0); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return query(`SELECT * FROM website_rules ${where} ORDER BY domain_ascii COLLATE NOCASE LIMIT 5000`, params).map(mapRule);
  }

  function saveRule(input) {
    const rule = normalizeRule(input);
    const timestamp = now();
    return transaction(() => {
      if (rule.id) {
        const existing = query("SELECT id FROM website_rules WHERE id = ?", [rule.id])[0];
        if (!existing) throw new Error("Website rule was not found");
        db().run("UPDATE website_rules SET domain_ascii = ?, action = ?, enabled = ?, include_subdomains = ?, updated_at = ? WHERE id = ?", [rule.domain, rule.action, rule.enabled ? 1 : 0, rule.includeSubdomains ? 1 : 0, timestamp, rule.id]);
        writeRevision();
        return mapRule(query("SELECT * FROM website_rules WHERE id = ?", [rule.id])[0]);
      }
      db().run("INSERT INTO website_rules (domain_ascii, action, enabled, include_subdomains, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [rule.domain, rule.action, rule.enabled ? 1 : 0, rule.includeSubdomains ? 1 : 0, timestamp, timestamp]);
      const id = db().exec("SELECT last_insert_rowid() AS id")[0].values[0][0];
      writeRevision();
      return mapRule(query("SELECT * FROM website_rules WHERE id = ?", [id])[0]);
    });
  }

  function setRuleEnabled(id, enabled) {
    if (!Number.isSafeInteger(id) || id < 1 || typeof enabled !== "boolean") throw new Error("Rule update is invalid");
    return transaction(() => {
      db().run("UPDATE website_rules SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, now(), id]);
      const changed = db().getRowsModified() > 0;
      if (changed) writeRevision();
      return changed;
    });
  }

  function removeRule(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Rule ID is invalid");
    return transaction(() => {
      db().run("DELETE FROM website_rules WHERE id = ?", [id]);
      const removed = db().getRowsModified() > 0;
      if (removed) writeRevision();
      return removed;
    });
  }

  function getSettings() {
    const row = query("SELECT enabled, mode, default_action, log_retention_days, policy_revision, last_sync_at, updated_at FROM website_access_settings WHERE id = 1")[0];
    return {
      enabled: row.enabled === 1, mode: row.mode, defaultAction: row.default_action,
      logRetentionDays: Number(row.log_retention_days),
      policyRevision: Number(row.policy_revision), lastSyncAt: row.last_sync_at, updatedAt: row.updated_at,
      enforcementAvailable: false,
    };
  }

  function saveSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["enabled", "mode", "defaultAction", "logRetentionDays"].includes(key))) throw new Error("Settings payload is invalid");
    if (typeof input.enabled !== "boolean" || input.mode !== "monitoring" || !["allow", "deny"].includes(input.defaultAction) || !Number.isSafeInteger(input.logRetentionDays) || input.logRetentionDays < 1 || input.logRetentionDays > 3650) throw new Error("Only valid stored monitoring settings are available in this version");
    return transaction(() => {
      db().run("UPDATE website_access_settings SET enabled = ?, mode = 'monitoring', default_action = ?, log_retention_days = ?, policy_revision = policy_revision + 1, updated_at = ? WHERE id = 1", [input.enabled ? 1 : 0, input.defaultAction, input.logRetentionDays, now()]);
      return getSettings();
    });
  }

  function getStatus() {
    const row = query("SELECT state, service_version, heartbeat_at, applied_revision, connection_status, last_error, updated_at FROM website_service_status WHERE id = 1")[0];
    return {
      protectionEnabled: getSettings().enabled,
      mode: "monitoring",
      service: { installed: false, state: "not_installed", version: null, heartbeatAt: null, connectionStatus: "not_configured" },
      policyRevision: getSettings().policyRevision,
      appliedRevision: Number(row.applied_revision),
      lastSyncAt: null,
      recoveryStatus: "not_applicable",
      enforcementImplemented: false,
      activityAvailable: false,
      message: "Settings and rules are stored locally. Network enforcement is not implemented.",
    };
  }

  function listLogs({ limit = 50, beforeId } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Log page size must be between 1 and 100");
    if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) throw new Error("Log cursor is invalid");
    // No service exists in this phase, so no activity records are fabricated.
    return { available: false, entries: [], nextCursor: null };
  }

  function applyImportedRules(rules, settings) {
    if (!Array.isArray(rules) || rules.length > 5000) throw new Error("Import rule set is invalid");
    const normalized = rules.map((rule) => normalizeRule(rule));
    const domains = new Set();
    normalized.forEach((rule) => {
      if (domains.has(rule.domain)) throw new Error("Import contains duplicate normalized domains");
      domains.add(rule.domain);
    });
    return transaction(() => {
      for (const rule of normalized) {
        const existing = query("SELECT id FROM website_rules WHERE domain_ascii = ?", [rule.domain])[0];
        if (existing) {
          db().run("UPDATE website_rules SET action = ?, enabled = ?, include_subdomains = ?, updated_at = ? WHERE id = ?", [rule.action, rule.enabled ? 1 : 0, rule.includeSubdomains ? 1 : 0, now(), existing.id]);
        } else {
          db().run("INSERT INTO website_rules (domain_ascii, action, enabled, include_subdomains, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [rule.domain, rule.action, rule.enabled ? 1 : 0, rule.includeSubdomains ? 1 : 0, now(), now()]);
        }
      }
      if (settings) {
        db().run("UPDATE website_access_settings SET enabled = ?, mode = 'monitoring', default_action = ?, log_retention_days = ?, updated_at = ? WHERE id = 1", [settings.enabled ? 1 : 0, settings.defaultAction, settings.logRetentionDays, now()]);
      }
      if (normalized.length || settings) writeRevision();
      return { imported: normalized.length, policyRevision: getSettings().policyRevision };
    });
  }

  function exportConfig() {
    return {
      format: "jlj-website-access",
      version: 1,
      settings: { enabled: getSettings().enabled, mode: "monitoring", defaultAction: getSettings().defaultAction, logRetentionDays: getSettings().logRetentionDays },
      rules: listRules().map(({ domain, action, enabled, includeSubdomains }) => ({ domain, action, enabled, includeSubdomains })),
    };
  }

  return { listRules, saveRule, setRuleEnabled, removeRule, getSettings, saveSettings, getStatus, listLogs, applyImportedRules, exportConfig };
}

module.exports = { createWebsiteAccessRepository };
