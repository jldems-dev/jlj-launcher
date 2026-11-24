const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { Writable } = require("node:stream");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test } = require("node:test");
const {
  createChromeProtection,
  validateRequest,
} = require("../src/main/services/chromeProtectionService");

const audit = { sample: "", install: false, execution: true, portable: false };

test("requires an explicit confirmation and validates the audit scope", () => {
  assert.deepEqual(validateRequest("audit", { ...audit, ignored: true }), audit);
  assert.deepEqual(validateRequest("enable"), {});
  assert.throws(() => validateRequest("enable", { confirmed: "true" }));
  assert.throws(() => validateRequest("audit", { ...audit, sample: "\\\\server\\file.exe" }));
  assert.throws(() => validateRequest("audit", { ...audit, execution: false }));
  assert.throws(() => validateRequest("disable", { force: true }));
  assert.deepEqual(validateRequest("status", { elevate: true }), { elevate: true });
  assert.throws(() => validateRequest("arbitrary", audit));
});

test("serializes Windows requests and returns the confirmed Windows result", async () => {
  let resolve;
  let script;
  const processResult = new Promise((success) => { resolve = success; });
  processResult.child = new EventEmitter();
  processResult.child.stdin = new Writable({
    write(chunk, encoding, done) {
      script = chunk.toString();
      done();
    },
  });
  const service = createChromeProtection({ platform: "win32", runCommand: () => processResult });
  const pending = service.run("audit", audit);
  await assert.rejects(service.run("disable", {}), /already running/);
  const input = script.match(/FromBase64String\('([^']+)'\)/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(input, "base64")), { action: "audit", ...audit });
  resolve({ stdout: '{"state":"audit","managed":true}' });
  assert.deepEqual(await pending, { state: "audit", managed: true });
});

test("reports Windows failures and unsupported platforms without reporting enforcement", async () => {
  const missing = createChromeProtection({ platform: "linux" });
  assert.equal((await missing.run("status", {})).state, "unsupported");
  const invalid = createChromeProtection({
    platform: "win32",
    runCommand: async () => ({ stdout: "invalid output" }),
  });
  assert.equal((await invalid.run("status", {})).state, "error");
});

test("keeps Windows tools in the existing Settings modal", () => {
  const html = readFileSync(require.resolve("../index.html"), "utf8");
  const [sidebar, remainder] = html.split('id="ownerSettingsModal"');
  const settings = remainder.split('id="deleteModal"')[0];
  assert.doesNotMatch(sidebar, /Control Panel|Local Group Policy|id="cpModal"/);
  for (const tab of ["general", "control", "policy", "chrome"]) {
    assert.match(settings, new RegExp(`aria-controls="settings-${tab}"`));
    assert.match(settings, new RegExp(`id="settings-${tab}" role="tabpanel"`));
  }
  assert.doesNotMatch(settings, /chromeCustomer|Local Windows customer username/);
  assert.match(settings, /id="saveServerUrlButton"/);
  assert.match(settings, /id="savePcSpecButton"/);
  assert.match(settings, /onclick="openWindowsControlPanel\(\)"/);
  assert.match(settings, /onclick="openLocalGroupPolicyEditor\(\)"/);
});

test("generates audit-only AppLocker rules scoped to the Windows user SID", {
  skip: process.platform !== "win32",
}, async () => {
  const source = readFileSync(require.resolve("../src/main/services/chromeProtection.ps1"), "utf8");
  const definitions = source.slice(0, source.indexOf("function Save-Record"));
  const fixture = String.raw`
$files = @([pscustomobject]@{ Path = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; Kind = 'browser'; Installed = $true })
$config = @{ execution = $true; portable = $false; install = $false }
$policy = New-AuditPolicy $files $config 'S-1-5-21-1-2-3-1001'
$deny = $policy.SelectSingleNode('//FilePathRule[@Action="Deny"]')
@{
  modes = @($policy.SelectNodes('//RuleCollection') | ForEach-Object EnforcementMode)
  sid = $deny.UserOrGroupSid
  path = $deny.Conditions.FilePathCondition.Path
  allow = @($policy.SelectNodes('//*[@Action="Allow"]') | ForEach-Object UserOrGroupSid)
} | ConvertTo-Json -Compress`;
  const run = promisify(execFile);
  const processResult = run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))",
  ]);
  processResult.child.stdin.end(definitions + "\n" + fixture);
  const { stdout } = await processResult;
  assert.deepEqual(JSON.parse(stdout), {
    modes: ["AuditOnly", "AuditOnly"],
    sid: "S-1-5-21-1-2-3-1001",
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    allow: ["S-1-1-0", "S-1-1-0"],
  });
});

test("audits before enforcement, detects policy drift and restores the backup", {
  skip: process.platform !== "win32",
}, async () => {
  const source = readFileSync(require.resolve("../src/main/services/chromeProtection.ps1"), "utf8");
  const entryPoint = source.search(/^try \{\r?\n    \$identity =/m);
  assert.ok(entryPoint >= 0, "Chrome Protection entry point was not found");
  const definitions = source.slice(0, entryPoint);
  const fixture = String.raw`
$baseline = '<AppLockerPolicy Version="1"/>'
$script:policyXml = $baseline
$record = @{}
$files = @([pscustomobject]@{ Path = 'C:\Chrome\chrome.exe'; Kind = 'browser'; Installed = $true })
function Get-UnsupportedReason {}
function Get-Service { @{ Status = 'Running' } }
function Start-ApplicationIdentity {}
$currentSid = 'S-1-5-21-1-2-3-1001'
function Get-Policy([switch]$Effective) { [xml]$script:policyXml }
function Set-Policy([xml]$Policy) { $script:policyXml = $Policy.OuterXml }
function Save-Record {}
$request = @{ action = 'enable' }
try { Invoke-Protection; throw 'Unexpected success' }
catch { if ($_.Exception.Message -notlike 'Start and verify audit mode*') { throw } }
$request = [pscustomobject]@{ action = 'audit'; execution = $true }
Invoke-Protection
if ($result.state -ne 'audit' -or !$record.backup -or $record.sid -ne $currentSid) { throw 'Audit state or backup missing' }
$request.action = 'enable'
$originalSid = $currentSid
$currentSid = 'S-1-5-21-1-2-3-1002'
try { Invoke-Protection; throw 'Unexpected success' }
catch { if ($_.Exception.Message -notlike '*different Windows account*') { throw } }
$currentSid = $originalSid
Invoke-Protection
if ($result.state -ne 'enabled') { throw 'Expected effective enforcement' }
$request.action = 'disable'
$enforced = $script:policyXml
$script:policyXml = '<AppLockerPolicy Version="1"><RuleCollection Type="Dll" EnforcementMode="Enabled"/></AppLockerPolicy>'
try { Invoke-Protection; throw 'Unexpected success' }
catch { if ($_.Exception.Message -notlike 'Local AppLocker policy changed*') { throw } }
$script:policyXml = $enforced
Invoke-Protection
if ($result.state -ne 'disabled' -or $result.managed -or (Get-PolicyFingerprint ([xml]$script:policyXml))) {
    throw 'Backup was not restored'
}
'passed'`;
  const run = promisify(execFile);
  const processResult = run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))",
  ]);
  processResult.child.stdin.end(definitions + "\n" + fixture);
  const { stdout } = await processResult;
  assert.equal(stdout.trim(), "passed");
});

test("requests UAC only for explicit status checks and carries the same Windows SID", async () => {
  const sid = "S-1-5-21-1-2-3-1001";
  const service = createChromeProtection({
    platform: "win32",
    runCommand: async () => ({ stdout: JSON.stringify({
      state: "unsupported", elevationSid: sid, paths: ["C:\\Chrome\\chrome.exe"],
    }) }),
    elevate: async (command) => {
      const encoded = command.match(/-EncodedCommand (\S+)$/)[1];
      const bootstrap = Buffer.from(encoded, "base64").toString("utf16le");
      const input = bootstrap.match(/FromBase64String\('([^']+)'\)/)[1];
      const { file, digest } = JSON.parse(Buffer.from(input, "base64"));
      const data = readFileSync(file);
      assert.equal(require("node:crypto").createHash("sha256").update(data).digest("hex"), digest);
      const { request } = JSON.parse(data);
      assert.deepEqual(request, { action: "status", elevate: true, expectedSid: sid });
      return '{"state":"audit","managed":true}';
    },
  });
  assert.deepEqual(await service.run("status", {}), {
    state: "unsupported", requiresElevation: true, paths: ["C:\\Chrome\\chrome.exe"],
  });
  assert.deepEqual(await service.run("status", { elevate: true }), { state: "audit", managed: true });
});

test("Chrome Enable is gated by audit state and sends the enforcement IPC after audit", async () => {
  const vm = require("node:vm");
  const renderer = readFileSync(require.resolve("../src/renderer/features/chromeProtection.js"), "utf8");
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      addEventListener(event, handler) { this[event] = handler; },
    });
    return elements.get(id);
  }
  const requests = [];
  const ipc = async (...args) => {
    requests.push(args);
    return { cancelled: true };
  };
  const realm = vm.createContext({ $: element, State: { isOwnerLoggedIn: true }, window: {
    electronAPI: { chromeProtection: ipc },
  } });
  vm.runInContext(renderer + "\nbindChromeProtection();", realm);
  assert.equal(element("chromeEnable").disabled, true);
  vm.runInContext('renderChromePolicy({ state: "needsElevation", requiresElevation: true }); updateChromeButtons();', realm);
  assert.equal(element("chromeAudit").disabled, false);
  assert.equal(element("chromeEnable").disabled, true);
  vm.runInContext('renderChromePolicy({ state: "audit" }); updateChromeButtons();', realm);
  assert.equal(element("chromeEnable").disabled, false);
  element("chromeEnable").click();
  await new Promise(setImmediate);
  assert.deepEqual(requests, [["enable", undefined]]);
  assert.equal(element("chromeStatus").textContent, "Audit mode");
});

test("owner IPC shows the enforcement dialog and requires an affirmative response", async () => {
  const vm = require("node:vm");
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const source = readFileSync(require.resolve("../src/main/ipc/registerIpcHandlers"), "utf8");
  const root = path.resolve(__dirname, "..");
  const module = { exports: {} };
  const handles = new Map();
  const calls = [];
  let answer = 0;
  const frame = { url: pathToFileURL(path.join(root, "index.html")).href };
  const contents = { mainFrame: frame, isDestroyed: () => false, on() {} };
  const window = { webContents: contents };
  vm.runInNewContext(source, {
    module,
    require(id) {
      if (id === "electron") return {
        app: { getAppPath: () => root },
        dialog: { async showMessageBox(parent, options) {
          assert.equal(parent, window);
          assert.equal(options.cancelId, 0);
          calls.push("confirmation");
          return { response: answer };
        } },
      };
      if (id.endsWith("chromeProtectionService")) return {
        validateRequest,
        createChromeProtection: () => ({ run(action) { calls.push(action); } }),
      };
      if (id.endsWith("discordService")) return { createDiscordService: () => ({}) };
      if (id.endsWith("driveAccessPolicyService")) return {};
      if (id.endsWith("systemActivityService")) return {};
      return require(id);
    },
  });
  module.exports.registerIpcHandlers({
    ipcMain: { handle(key, listener) { handles.set(key, listener); }, on() {} },
    store: { verifyOwner: async () => true },
    getMainWindow: () => window,
  });
  const event = { sender: contents, senderFrame: frame };
  const protect = handles.get("chrome:protection");
  await assert.rejects(protect(event, "enable"), /Owner login required/);
  await handles.get("db-verify-owner")(event, "owner", "fixture");
  assert.equal((await protect(event, "enable")).cancelled, true);
  assert.deepEqual(calls, ["confirmation"]);
  answer = 1;
  await protect(event, "enable");
  assert.deepEqual(calls, ["confirmation", "confirmation", "enable"]);
});
