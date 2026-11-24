const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { validateRequest } = require("../src/main/services/driveAccessPolicyService");

test("accepts only supported drive policy actions and Windows drive options", () => {
  assert.throws(() => validateRequest("reset"), /Invalid drive policy action/);
  assert.throws(() => validateRequest("enable", "Guest"), /valid Windows drive/);
  assert.throws(() => validateRequest("enable", -1), /valid Windows drive/);
  assert.throws(() => validateRequest("disable", 4), /valid Windows drive/);
  assert.doesNotThrow(() => validateRequest("enable", 0));
  assert.doesNotThrow(() => validateRequest("rollback"));
});

test("supports drive access from the owner-only Local Group Policy tab", () => {
  const html = readFileSync(require.resolve("../index.html"), "utf8");
  const policyTab = html.split('id="settings-policy"')[1].split('id="settings-chrome"')[0];
  assert.match(policyTab, /Prevent access to drives from My Computer/);
  assert.doesNotMatch(policyTab, /driveAccessCustomer|customer username/);
  for (const action of ["Refresh", "Enable", "Disable", "Rollback"]) {
    assert.match(policyTab, new RegExp(`id="driveAccess${action}"`));
  }
  const ipc = readFileSync(require.resolve("../src/main/ipc/registerIpcHandlers"), "utf8");
  assert.match(ipc, /"cp:drive-access", ownerRequest\(manageDriveAccessPolicy\)/);
});

test("preserves the Windows selection across re-enable, including a zero mask", {
  skip: process.platform !== "win32",
}, async () => {
  const source = readFileSync(require.resolve("../src/main/services/driveAccessPolicy.cs"), "utf8");
  const input = Buffer.from(source).toString("base64");
  const command = `
Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')))
$method = [DriveAccessPolicy].GetMethod('ResolveEnableMask', [Reflection.BindingFlags]'NonPublic,Static')
$state = [DriveAccessPolicy+State]::new()
$state.configured = 'disabled'
$state.savedMask = 0
$state.effectiveMask = 8
$reenabled = $method.Invoke($null, @($state, 4))
$state.configured = 'unconfigured'
$inherited = $method.Invoke($null, @($state, 4))
$state.effectiveMask = $null
$state.savedMask = $null
$initial = $method.Invoke($null, @($state, 15))
@($reenabled, $inherited, $initial) | ConvertTo-Json -Compress`;
  const run = promisify(execFile);
  const result = run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))",
  ]);
  result.child.stdin.end("$ErrorActionPreference = 'Stop'\n" + command);
  const { stdout } = await result;
  assert.deepEqual(JSON.parse(stdout), [0, 8, 15]);
});

test("rejects an elevation token from a different Windows account before loading policy code", {
  skip: process.platform !== "win32",
}, async () => {
  const script = readFileSync(require.resolve("../src/main/services/driveAccessPolicy.ps1"), "utf8");
  const run = promisify(execFile);
  const result = run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))",
  ]);
  result.child.stdin.end("$request = @{ expectedSid = 'S-1-5-18'; action = 'enable' }\n" + script);
  const { stdout } = await result;
  assert.match(JSON.parse(stdout).error, /same Windows account/);
});
