const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDiscordService, downloadInstaller } = require("../src/main/services/discordService");

async function fixture(t, prefix = "jlj-discord-test-") {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "Discord");
  async function addVersion(version) {
    const folder = path.join(root, `app-${version}`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "Discord.exe"), "test executable");
    await fs.writeFile(path.join(root, "Update.exe"), "test updater");
  }
  return { temp, root, addVersion, platform: "win32", arch: "x64", localAppData: temp };
}

test("detects Discord, launches its updater, and observes a newer installed version", async (t) => {
  const setup = await fixture(t, "jlj Discord test-");
  const calls = [];
  const service = createDiscordService({
    ...setup,
    activity: async () => "updater",
    verify: async (file) => calls.push(path.basename(file)),
    run: async (file, args) => {
      calls.push([file, args]);
      await setup.addVersion("1.0.10");
    },
  });
  assert.deepEqual(await service.status(), { supported: true, version: null, canLaunch: false, needsRepair: false, updaterRunning: false });
  await setup.addVersion("1.0.9");
  await fs.mkdir(path.join(setup.root, "app-1.0.100"));
  assert.equal((await service.status()).version, "1.0.9");
  assert.equal((await service.status()).updaterRunning, true);
  assert.equal((await service.launch()).version, "1.0.10");
  const updater = path.join(await fs.realpath(setup.root), "Update.exe");
  assert.deepEqual(calls, ["Update.exe", "Discord.exe", [updater, ["--processStart", "Discord.exe"]]]);
});

test("installs and repairs through the verified setup without changing existing data", async (t) => {
  const setup = await fixture(t);
  const data = path.join(setup.temp, "discord-settings.json");
  await fs.writeFile(data, "existing user data");
  const events = [];
  let verified;
  const service = createDiscordService({
    ...setup,
    activity: async () => "idle",
    download: async (file, report) => {
      await fs.writeFile(file, "installer");
      report({ phase: "downloading", percent: 100 });
    },
    verify: async (file) => { verified = file; },
    run: async (file, args) => {
      assert.equal(file, verified);
      assert.deepEqual(args, []);
      await setup.addVersion("1.0.10");
    },
  });
  assert.equal((await service.install((event) => events.push(event))).canLaunch, true);
  assert.deepEqual(events.map(({ phase }) => phase), ["downloading", "downloading", "verifying", "installing"]);
  await assert.rejects(fs.stat(verified), { code: "ENOENT" });
  await fs.unlink(path.join(setup.root, "Update.exe"));
  assert.equal((await service.status()).needsRepair, true);
  assert.equal((await service.install(() => {})).canLaunch, true);
  assert.equal(await fs.readFile(data, "utf8"), "existing user data");
});

test("blocks concurrent operations, active updates, and untrusted installers", async (t) => {
  const setup = await fixture(t);
  let running = true;
  let release;
  const service = createDiscordService({
    ...setup,
    activity: async () => running ? "updater" : "idle",
    download: () => new Promise((resolve) => { release = resolve; }),
    verify: async () => { throw new Error("Untrusted installer"); },
    run: () => assert.fail("Untrusted files must never run"),
  });
  await assert.rejects(service.install(() => {}), /updater is running/);
  running = false;
  const downloading = new Promise((resolve) => {
    const install = service.install(() => resolve({ install }));
  });
  const { install } = await downloading;
  await assert.rejects(service.launch(), /already in progress/);
  release();
  await assert.rejects(install, /Untrusted installer/);
});

test("downloads only from approved HTTPS hosts", async (t) => {
  const { temp } = await fixture(t);
  const file = path.join(temp, "DiscordSetup.exe");
  const request = async (url) => url.hostname === "discord.com"
    ? Response.redirect("https://stable.dl2.discordapp.net/DiscordSetup.exe")
    : new Response("installer", { headers: { "content-length": "9" } });
  const events = [];
  await downloadInstaller(file, (event) => events.push(event), request);
  assert.equal(await fs.readFile(file, "utf8"), "installer");
  assert.deepEqual(events, [{ phase: "downloading", percent: 100 }]);
  await assert.rejects(downloadInstaller(file, () => {}, async (url) => {
    assert.equal(url.hostname, "discord.com");
    return Response.redirect("https://stable.dl2.discordapp.net.example.com/DiscordSetup.exe");
  }), /unapproved address/);
});
