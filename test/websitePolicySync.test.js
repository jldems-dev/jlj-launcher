const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { runInThisContext } = require("node:vm");
const { compilePolicySnapshot, createPolicySnapshot, evaluatePolicy } = require("../src/main/websiteAccess/policyEngine");

function registerWebsiteHandlers(options) {
  const filename = require.resolve("../src/main/ipc/registerIpcHandlers");
  const localRequire = createRequire(filename);
  const appPath = path.join(__dirname, "..");
  const electron = { app: { getAppPath: () => appPath } };
  const loadHandlers = runInThisContext(`(function (require, module) {\n${readFileSync(filename, "utf8")}\n})`, { filename });
  const handlerModule = { exports: {} };
  loadHandlers((name) => name === "electron" ? electron : localRequire(name), handlerModule);

  const mainFrame = { url: pathToFileURL(path.join(appPath, "index.html")).href };
  const sender = { id: 1, mainFrame };
  const event = { sender, senderFrame: mainFrame };
  const handlers = new Map();
  handlerModule.exports.registerIpcHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    getMainWindow: () => ({ webContents: sender }),
    ownerSession: { isActive: (id) => id === sender.id },
    ...options,
  });
  return { handlers, event };
}

test("owner rule saves publish default-deny policy and can retry after the service is unavailable", async () => {
  const rules = [];
  const applied = [];
  let revision = 0;
  let serviceOnline = false;
  let releaseApply;
  const { handlers, event } = registerWebsiteHandlers({
    store: {
      listWebsiteRules: () => rules,
      getWebsiteAccessSettings: () => ({ policyRevision: revision }),
      saveWebsiteRule(rule) {
        revision++;
        const saved = { ...rule, id: revision };
        rules.push(saved);
        return saved;
      },
    },
    websiteServiceClient: {
      async applyPolicy(policy) {
        if (!serviceOnline) throw Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" });
        applied.push(policy);
        if (applied.length === 1) await new Promise((resolve) => { releaseApply = resolve; });
        return { policyRevision: policy.policyRevision, enforcementActive: false };
      },
    },
  });

  const save = handlers.get("website-access:save-rule");
  const sync = handlers.get("website-access:service-sync-policy");
  const google = { domain: "google.com", action: "allow", enabled: true, includeSubdomains: true };
  const blocked = { domain: "www.google.com", action: "block", enabled: true, includeSubdomains: false };

  await assert.rejects(save({ ...event, senderFrame: {} }, google), /Unauthorized/);
  assert.deepEqual(await save(event, google), { ...google, id: 1 });
  assert.deepEqual(await sync(event), { available: false, code: "SERVICE_UNAVAILABLE" });

  serviceOnline = true;
  const retry = sync(event);
  await Promise.resolve();
  assert.equal(applied.length, 1);
  const saveBlock = save(event, blocked);
  await Promise.resolve();
  assert.equal(applied.length, 1);
  releaseApply();
  assert.equal((await retry).result.policyRevision, 1);
  assert.deepEqual(await saveBlock, { ...blocked, id: 2 });
  assert.deepEqual(applied.map((policy) => policy.policyRevision), [1, 2]);

  const first = compilePolicySnapshot(applied[0]);
  const latest = compilePolicySnapshot(applied[1]);
  assert.equal(evaluatePolicy("www.google.com", first).action, "allow");
  assert.equal(evaluatePolicy("google.com", latest).action, "allow");
  assert.equal(evaluatePolicy("www.facebook.com", latest).reason, "default-deny");
  assert.equal(evaluatePolicy("www.google.com", latest).reason, "blocked-by-rule");
});

test("protection requests require the owner and refuse changes without verified DNS prerequisites", async () => {
  const audit = [];
  let resolveStatus;
  let statusCalls = 0;
  const synchronizedStatus = {
    state: "healthy", lastAcceptedRevision: 8, lastAcceptedSha256: createPolicySnapshot([], 8).sha256,
    resolverConfigured: false, enforcementActive: false,
  };
  const { handlers, event } = registerWebsiteHandlers({
    logger: { log: (...args) => audit.push(args) },
    store: { getWebsiteAccessSettings: () => ({ policyRevision: 8 }), listWebsiteRules: () => [] },
    websiteServiceClient: {
      getStatus() {
        statusCalls++;
        if (statusCalls === 1) return new Promise((resolve) => { resolveStatus = resolve; });
        if (statusCalls === 3) return synchronizedStatus;
        throw Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" });
      },
    },
  });
  const request = handlers.get("website-access:request-protection");
  await assert.rejects(request({ ...event, senderFrame: {} }, true), /Unauthorized/);
  await assert.rejects(request(event, "true"), /invalid/);

  const pending = request(event, true);
  assert.match((await request(event, true)).reasons[0], /already in progress/);
  assert.equal(statusCalls, 1);
  resolveStatus({ ...synchronizedStatus, lastAcceptedSha256: "different" });
  const { reasons } = await pending;
  assert.match(reasons.join(" "), /Sync the current policy.*ALLOW rule.*upstream DNS resolver.*recovery/);
  assert.match((await request(event, false)).reasons[0], /SERVICE_UNAVAILABLE/);
  const getStatus = handlers.get("website-access:service-status");
  const connected = await getStatus(event);
  assert.equal(connected.readiness.policySynchronized, true);
  assert.match(connected.readiness.reasons.join(" "), /ALLOW rule.*upstream DNS resolver.*recovery/);
  const disconnected = await getStatus(event);
  assert.equal(disconnected.readiness.policySynchronized, false);
  assert.match(disconnected.readiness.reasons[0], /SERVICE_UNAVAILABLE/);
  assert.deepEqual(audit.map((entry) => entry[2]), ["Enable protection request refused", "Disable protection request refused"]);
});
