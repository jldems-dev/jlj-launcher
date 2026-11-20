"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPolicySnapshot,
  validatePolicySnapshot,
  compilePolicySnapshot,
  evaluatePolicy,
} = require("../src/main/websiteAccess/policyEngine");

function rule(domain, action = "allow", options = {}) {
  return { domain, action, enabled: options.enabled ?? true, includeSubdomains: options.includeSubdomains ?? false };
}

test("builds deterministic versioned snapshots and validates their digest", () => {
  const rules = [rule("BÜCHER.de.", "allow", { includeSubdomains: true }), rule("blocked.example", "block")];
  const first = createPolicySnapshot(rules, 12);
  const second = createPolicySnapshot([...rules].reverse(), 12);
  assert.deepEqual(first, second);
  assert.equal(first.protocolVersion, 1);
  assert.equal(first.defaultAction, "deny");
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validatePolicySnapshot(first), first);
});

test("allows only enabled owner-approved rules and optional label-boundary subdomains", () => {
  const policy = compilePolicySnapshot(createPolicySnapshot([
    rule("approved.example", "allow", { includeSubdomains: true }),
    rule("disabled.example", "allow", { enabled: false, includeSubdomains: true }),
  ], 4));
  assert.equal(evaluatePolicy("approved.example", policy).action, "allow");
  assert.equal(evaluatePolicy("a.approved.example", policy).action, "allow");
  assert.equal(evaluatePolicy("notapproved.example", policy).reason, "default-deny");
  assert.equal(evaluatePolicy("a.disabled.example", policy).reason, "default-deny");
  assert.equal(evaluatePolicy("unknown.example", policy).action, "deny");
});

test("any matching enabled block rule overrides a more-specific allow", () => {
  const policy = compilePolicySnapshot(createPolicySnapshot([
    rule("example.com", "block", { includeSubdomains: true }),
    rule("shop.example.com", "allow", { includeSubdomains: true }),
  ], 7));
  assert.deepEqual(evaluatePolicy("shop.example.com", policy), {
    action: "deny", reason: "blocked-by-rule", matchedDomain: "example.com", policyRevision: 7,
  });
});

test("a more-specific allow wins when no matching block exists", () => {
  const policy = compilePolicySnapshot(createPolicySnapshot([
    rule("example.com", "allow", { includeSubdomains: true }),
    rule("blocked.example.com", "block", { includeSubdomains: true }),
    rule("safe.blocked.example.com", "allow", { includeSubdomains: true }),
  ], 8));
  assert.equal(evaluatePolicy("safe.example.com", policy).action, "allow");
  assert.equal(evaluatePolicy("safe.blocked.example.com", policy).action, "deny");
});

test("fails closed on invalid DNS names and requires a compiled policy", () => {
  const policy = compilePolicySnapshot(createPolicySnapshot([rule("ok.example")], 0));
  assert.equal(evaluatePolicy("127.0.0.1", policy).reason, "invalid-domain");
  assert.equal(evaluatePolicy("bad..example", policy).action, "deny");
  assert.throws(() => evaluatePolicy("ok.example", createPolicySnapshot([], 0)), /compiled policy/i);
});

test("rejects unsupported versions, non-deny defaults, stale or tampered digests", () => {
  const snapshot = createPolicySnapshot([rule("ok.example")], 1);
  for (const candidate of [
    { ...snapshot, protocolVersion: 2 },
    { ...snapshot, defaultAction: "allow" },
    { ...snapshot, policyRevision: -1 },
    { ...snapshot, sha256: "0".repeat(64) },
    { ...snapshot, unexpected: true },
    { ...snapshot, rules: [{ ...snapshot.rules[0], enabled: 1 }] },
  ]) assert.throws(() => validatePolicySnapshot(candidate));
});

test("rejects duplicate normalized domains, invalid rules, and oversized snapshots", () => {
  assert.throws(() => createPolicySnapshot([rule("Example.com"), rule("example.com.", "block")], 1), /duplicate/i);
  assert.throws(() => createPolicySnapshot([rule("127.0.0.1")], 1));
  assert.throws(() => createPolicySnapshot([rule("ok.example", "permit")], 1));
  const hugeRuleSet = Array.from({ length: 3500 }, (_, index) => rule(
    `r${String(index).padStart(4, "0")}.${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(55)}`,
  ));
  assert.throws(() => createPolicySnapshot(hugeRuleSet, 1), /maximum message size/i);
});
