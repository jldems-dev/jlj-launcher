"use strict";

const crypto = require("node:crypto");
const { normalizeRule, MAX_RULES } = require("./domainRules");

const MAX_IMPORT_BYTES = 1024 * 1024;
const FORMAT = "jlj-website-access";
const VERSION = 1;

function validateImportText(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new Error("Import file exceeds the 1 MiB limit");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Import file is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Import must be a JSON object");
  if (Object.keys(parsed).some((key) => !["format", "version", "settings", "rules"].includes(key))) throw new Error("Import contains unsupported top-level fields");
  if (parsed.format !== FORMAT || parsed.version !== VERSION) throw new Error("Import format or version is unsupported");
  if (!Array.isArray(parsed.rules) || parsed.rules.length > MAX_RULES) throw new Error("Import must contain no more than 5000 rules");

  let settings;
  if (parsed.settings !== undefined) {
    if (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings) || Object.keys(parsed.settings).some((key) => !["enabled", "mode", "defaultAction", "logRetentionDays"].includes(key))) throw new Error("Import settings are invalid");
    const value = parsed.settings;
    if (typeof value.enabled !== "boolean" || value.mode !== "monitoring" || !["allow", "deny"].includes(value.defaultAction) || !Number.isSafeInteger(value.logRetentionDays) || value.logRetentionDays < 1 || value.logRetentionDays > 3650) throw new Error("Import settings are invalid; enforcement is unavailable");
    settings = { enabled: value.enabled, mode: "monitoring", defaultAction: value.defaultAction, logRetentionDays: value.logRetentionDays };
  }

  const rules = parsed.rules.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["domain", "action", "enabled", "includeSubdomains"].includes(key))) {
      return { index: index + 1, error: "Rule contains unsupported fields" };
    }
    try { return { index: index + 1, rule: normalizeRule(item) }; }
    catch (error) { return { index: index + 1, error: error.message }; }
  });
  return { settings, rules, contentHash: crypto.createHash("sha256").update(text, "utf8").digest("hex") };
}

function buildImportPreview(validated, existingRules) {
  const existing = new Map(existingRules.map((rule) => [rule.domain, rule]));
  const seen = new Map();
  const invalidDomains = new Set();
  const entries = [];
  const errors = validated.rules.filter((entry) => entry.error).map(({ index, error }) => ({ index, error }));

  for (const entry of validated.rules) {
    if (!entry.rule) continue;
    const previous = seen.get(entry.rule.domain);
    if (previous) {
      const same = previous.rule.action === entry.rule.action && previous.rule.enabled === entry.rule.enabled && previous.rule.includeSubdomains === entry.rule.includeSubdomains;
      if (same) entries.push({ index: entry.index, domain: entry.rule.domain, disposition: "skip", reason: "Duplicate within import" });
      else {
        invalidDomains.add(entry.rule.domain);
        errors.push({ index: entry.index, error: `Conflicting duplicate for ${entry.rule.domain}` });
      }
      continue;
    }
    seen.set(entry.rule.domain, entry);
    const current = existing.get(entry.rule.domain);
    const identical = current && current.action === entry.rule.action && current.enabled === entry.rule.enabled && current.includeSubdomains === entry.rule.includeSubdomains;
    entries.push({ index: entry.index, rule: entry.rule, disposition: !current ? "add" : identical ? "skip" : "update", reason: !current ? "New domain" : identical ? "Already matches current rule" : "Existing rule will be updated" });
  }

  const accepted = entries.filter((entry) => entry.rule && !invalidDomains.has(entry.rule.domain) && entry.disposition !== "skip").map((entry) => entry.rule);
  const skipped = entries.filter((entry) => entry.disposition === "skip").length;
  return {
    rules: accepted,
    entries: entries.map(({ index, rule, ...rest }) => ({ index, ...rest, ...(rule ? { domain: rule.domain, action: rule.action } : {}) })),
    errors,
    counts: {
      add: accepted.filter((rule) => !existing.has(rule.domain)).length,
      update: accepted.filter((rule) => existing.has(rule.domain)).length,
      skip: skipped,
      error: errors.length,
    },
    settings: validated.settings,
    contentHash: validated.contentHash,
  };
}

function createImportPreviewManager({ dialog, getMainWindow, repository, readFile = require("node:fs").promises.readFile, stat = require("node:fs").promises.stat, now = Date.now }) {
  const previews = new Map();
  const TTL_MS = 5 * 60 * 1000;

  async function preview(senderId) {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "Import Website Rules",
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile() || fileInfo.size > MAX_IMPORT_BYTES) throw new Error("Import file exceeds the 1 MiB limit");
    const text = await readFile(filePath, "utf8");
    const validated = validateImportText(text);
    const previewResult = buildImportPreview(validated, repository.listRules());
    const token = crypto.randomUUID();
    for (const [key, entry] of previews) if (entry.expiresAt <= now()) previews.delete(key);
    while (previews.size >= 3) previews.delete(previews.keys().next().value);
    previews.set(token, { senderId, expiresAt: now() + TTL_MS, hash: validated.contentHash, rules: previewResult.rules, settings: previewResult.settings });
    return { canceled: false, previewId: token, counts: previewResult.counts, errors: previewResult.errors, entries: previewResult.entries, hasSettings: !!previewResult.settings };
  }

  function apply(previewId, senderId) {
    if (typeof previewId !== "string" || previewId.length > 64) throw new Error("Import preview is invalid");
    const item = previews.get(previewId);
    previews.delete(previewId);
    if (!item || item.senderId !== senderId || item.expiresAt <= now()) throw new Error("Import preview expired; select the file again");
    // Re-normalize and re-check canonical uniqueness immediately before transaction.
    const rules = item.rules.map((rule) => normalizeRule(rule));
    if (new Set(rules.map((rule) => rule.domain)).size !== rules.length) throw new Error("Import preview contains duplicate domains");
    return repository.applyImportedRules(rules, item.settings);
  }

  return { preview, apply };
}

module.exports = { MAX_IMPORT_BYTES, validateImportText, buildImportPreview, createImportPreviewManager };
