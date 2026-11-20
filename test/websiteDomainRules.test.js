const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDomain, normalizeRule, findDuplicateRules, matchesRule, evaluateDomain } = require("../src/main/websiteAccess/domainRules");

test("normalizes case, IDNA and one terminal root dot", () => {
  assert.equal(normalizeDomain("  EXAMPLE.COM. "), "example.com");
  assert.equal(normalizeDomain("bücher.de"), "xn--bcher-kva.de");
});

test("rejects URL syntax, IPs, wildcards, malformed labels and invalid lengths", () => {
  for (const input of ["https://example.com", "example.com/path", "example.com:443", "*.example.com", "127.0.0.1", "::1", "a..example.com", "-bad.example", "bad-.example", "localhost"]) {
    assert.throws(() => normalizeDomain(input), input);
  }
  assert.throws(() => normalizeDomain(`${"a".repeat(64)}.com`));
});

test("detects duplicates after canonical normalization and rejects extra keys", () => {
  assert.deepEqual(findDuplicateRules([{ domain: "Example.com", action: "allow" }, { domain: "example.com.", action: "block" }]), [
    { domain: "example.com", firstIndex: 0, duplicateIndex: 1 },
  ]);
  assert.throws(() => normalizeRule({ domain: "example.com", action: "allow", command: "whoami" }), /unsupported/i);
});

test("matches exact domains, optional label-boundary subdomains and child specificity", () => {
  const parent = { domain: "example.com", action: "allow", includeSubdomains: true };
  assert.equal(matchesRule("example.com", parent), true);
  assert.equal(matchesRule("a.example.com", parent), true);
  assert.equal(matchesRule("notexample.com", parent), false);
  assert.equal(matchesRule("example.com", { ...parent, enabled: false }), false);
  assert.deepEqual(evaluateDomain("login.example.com", [parent, { domain: "login.example.com", action: "block" }]), {
    action: "block", matchedDomain: "login.example.com", source: "rule",
  });
});

test("default action applies only when no enabled rule matches", () => {
  assert.equal(evaluateDomain("unknown.example", [{ domain: "example.com", action: "allow", enabled: false, includeSubdomains: true }], "deny").action, "deny");
  assert.equal(evaluateDomain("a.example.com", [
    { domain: "example.com", action: "allow", includeSubdomains: true },
    { domain: "example.com", action: "block", includeSubdomains: true },
  ]).action, "block");
});
