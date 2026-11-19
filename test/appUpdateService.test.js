const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAppUpdateService } = require("../src/main/services/appUpdateService");

function fixture(overrides = {}) {
  const updater = new EventEmitter();
  Object.assign(updater, {
    autoDownload: true,
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "1.0.25" } }),
    downloadUpdate: async () => { updater.emit("update-downloaded", { version: "1.0.25" }); },
    quitAndInstall: () => {},
  });
  const messages = [];
  const service = createAppUpdateService({ autoUpdater: updater, app: { getVersion: () => "1.0.24" },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => messages.push(args) } }),
    logger: { log: () => {} }, ...overrides });
  service.setup();
  return { updater, service, messages };
}

test("coalesces concurrent checks and ignores non-newer versions", async () => {
  const { updater, service } = fixture();
  let resolveCheck;
  updater.checkForUpdates = () => new Promise((resolve) => { resolveCheck = resolve; });
  const first = service.checkForUpdates();
  const second = service.checkForUpdates();
  resolveCheck({ isUpdateAvailable: true, updateInfo: { version: "1.0.23" } });
  assert.equal((await first).status, "none");
  assert.equal((await second).status, "none");
});

test("holds downloaded update until active games close", async () => {
  let safe = false;
  const { updater, service } = fixture({ canInstallUpdate: () => safe });
  const result = await service.updateApp();
  assert.equal(result.status, "downloaded");
  assert.match(result.message, /active games/i);
  assert.equal(updater.autoDownload, false);
  safe = true;
  assert.equal((await service.updateApp()).status, "installing");
});

test("reports rate limits and missing releases without crashing", async () => {
  const { updater, service } = fixture();
  updater.checkForUpdates = async () => { const e = new Error("API rate limit exceeded"); e.statusCode = 403; throw e; };
  assert.match((await service.checkForUpdates()).message, /rate-limited/i);
  updater.checkForUpdates = async () => { const e = new Error("not found"); e.statusCode = 404; throw e; };
  assert.equal((await service.checkForUpdates()).status, "none");
});
