"use strict";

const crypto = require("node:crypto");
const { normalizeDomain, normalizeRule, MAX_RULES } = require("./domainRules");

const POLICY_VERSION = 1;
const MAX_POLICY_BYTES = 1024 * 1024;
const COMPILED_POLICY = Symbol("compiledWebsitePolicy");
const SNAPSHOT_KEYS = new Set(["protocolVersion", "policyRevision", "defaultAction", "rules", "sha256"]);
const RULE_KEYS = new Set(["domain", "action", "enabled", "includeSubdomains"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalPayload(policy) {
  return JSON.stringify({
    protocolVersion: policy.protocolVersion,
    policyRevision: policy.policyRevision,
    defaultAction: policy.defaultAction,
    rules: policy.rules.map((rule) => ({
      domain: rule.domain,
      action: rule.action,
      enabled: rule.enabled,
      includeSubdomains: rule.includeSubdomains,
    })),
  });
}

function checksumPayload(policy) {
  return crypto.createHash("sha256").update(canonicalPayload(policy), "utf8").digest("hex");
}

function canonicalizeRules(rules) {
  if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new Error("Policy rules are invalid or exceed the configured limit");
  const seen = new Set();
  const normalized = rules.map((input) => {
    if (!isPlainObject(input) || Object.keys(input).some((key) => !RULE_KEYS.has(key))) {
      throw new Error("Policy rule contains unsupported fields");
    }
    if (typeof input.enabled !== "boolean" || typeof input.includeSubdomains !== "boolean") {
      throw new Error("Policy rule flags must be explicit booleans");
    }
    const rule = normalizeRule(input);
    if (seen.has(rule.domain)) throw new Error("Policy contains duplicate normalized domains");
    seen.add(rule.domain);
    return {
      domain: rule.domain,
      action: rule.action,
      enabled: rule.enabled,
      includeSubdomains: rule.includeSubdomains,
    };
  });
  normalized.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : a.action < b.action ? -1 : a.action > b.action ? 1 : 0));
  return normalized;
}

function createPolicySnapshot(rules, policyRevision) {
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 0) throw new Error("Policy revision is invalid");
  const policy = {
    protocolVersion: POLICY_VERSION,
    policyRevision,
    defaultAction: "deny",
    rules: canonicalizeRules(rules),
  };
  policy.sha256 = checksumPayload(policy);
  if (Buffer.byteLength(JSON.stringify(policy), "utf8") > MAX_POLICY_BYTES) {
    throw new Error("Policy snapshot exceeds the maximum message size");
  }
  return policy;
}

function validatePolicySnapshot(snapshot) {
  if (!isPlainObject(snapshot) || Object.keys(snapshot).some((key) => !SNAPSHOT_KEYS.has(key))) {
    throw new Error("Policy snapshot contains unsupported fields");
  }
  if (Object.keys(snapshot).length !== SNAPSHOT_KEYS.size) throw new Error("Policy snapshot is incomplete");
  let encoded;
  try {
    encoded = JSON.stringify(snapshot);
  } catch {
    throw new Error("Policy snapshot is not serializable");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_POLICY_BYTES) throw new Error("Policy snapshot exceeds the maximum message size");
  if (snapshot.protocolVersion !== POLICY_VERSION) throw new Error("Policy protocol version is unsupported");
  if (!Number.isSafeInteger(snapshot.policyRevision) || snapshot.policyRevision < 0) throw new Error("Policy revision is invalid");
  if (snapshot.defaultAction !== "deny") throw new Error("Website policy must use whitelist-only default deny");
  if (typeof snapshot.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.sha256)) throw new Error("Policy SHA-256 is invalid");

  const policy = {
    protocolVersion: POLICY_VERSION,
    policyRevision: snapshot.policyRevision,
    defaultAction: "deny",
    rules: canonicalizeRules(snapshot.rules),
  };
  if (checksumPayload(policy) !== snapshot.sha256) throw new Error("Policy snapshot SHA-256 mismatch");
  policy.sha256 = snapshot.sha256;
  return policy;
}

function compilePolicySnapshot(snapshot) {
  const policy = validatePolicySnapshot(snapshot);
  const compiled = {
    protocolVersion: policy.protocolVersion,
    policyRevision: policy.policyRevision,
    defaultAction: "deny",
    sha256: policy.sha256,
    rules: policy.rules.map((rule) => Object.freeze({ ...rule })),
  };
  Object.defineProperty(compiled, COMPILED_POLICY, { value: true });
  Object.freeze(compiled.rules);
  return Object.freeze(compiled);
}

function evaluatePolicy(domain, compiledPolicy) {
  if (!compiledPolicy || compiledPolicy[COMPILED_POLICY] !== true) {
    throw new TypeError("A validated, compiled policy is required");
  }

  let host;
  try {
    host = normalizeDomain(domain);
  } catch {
    return { action: "deny", reason: "invalid-domain", matchedDomain: null, policyRevision: compiledPolicy.policyRevision };
  }

  const matches = compiledPolicy.rules.filter((rule) => rule.enabled && (
    host === rule.domain || (rule.includeSubdomains && host.endsWith(`.${rule.domain}`))
  ));
  const blocks = matches.filter((rule) => rule.action === "block");
  if (blocks.length) {
    blocks.sort((a, b) => b.domain.split(".").length - a.domain.split(".").length);
    return { action: "deny", reason: "blocked-by-rule", matchedDomain: blocks[0].domain, policyRevision: compiledPolicy.policyRevision };
  }

  const allows = matches.filter((rule) => rule.action === "allow");
  if (allows.length) {
    allows.sort((a, b) => b.domain.split(".").length - a.domain.split(".").length);
    return { action: "allow", reason: "allowed-by-rule", matchedDomain: allows[0].domain, policyRevision: compiledPolicy.policyRevision };
  }
  return { action: "deny", reason: "default-deny", matchedDomain: null, policyRevision: compiledPolicy.policyRevision };
}

module.exports = {
  POLICY_VERSION,
  MAX_POLICY_BYTES,
  createPolicySnapshot,
  validatePolicySnapshot,
  compilePolicySnapshot,
  evaluatePolicy,
};
