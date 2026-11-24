const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const sudo = require("sudo-prompt");

const execute = promisify(execFile);

function requestScript(request) {
  const input = Buffer.from(JSON.stringify(request)).toString("base64");
  return `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json`;
}

function runElevated(command) {
  return new Promise((resolve, reject) => {
    sudo.exec(command, { name: "JLJ Launcher" }, (error, stdout) => {
      if (error) reject(new Error("Windows elevation failed. " + error.message));
      else resolve(stdout);
    });
  });
}

async function runWindowsPolicy({
  scriptPath, sourcePath, request, allowElevation = true, timeout = 30_000,
  runCommand = execute, elevate = runElevated, windowsDirectory = process.env.SystemRoot,
}) {
  const script = fs.readFileSync(scriptPath, "utf8");
  const source = sourcePath ? fs.readFileSync(sourcePath, "utf8") : undefined;
  const shell = path.join(windowsDirectory || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const args = ["-NoProfile", "-NonInteractive", "-STA"];
  const result = runCommand(shell, [...args, "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"], {
    windowsHide: true, timeout, maxBuffer: 1024 * 1024,
  });
  result.child?.stdin.on("error", () => {});
  result.child?.stdin.end(requestScript({ ...request, source }) + "\n" + script);
  const { stdout } = await result;
  const state = JSON.parse(stdout.trim());
  if (!state.elevationSid || !allowElevation) return state;

  // The elevation command authenticates the exact request and source bytes
  // already read by the main process. A file keeps the command line short.
  const data = Buffer.from(JSON.stringify({
    request: { ...request, source, expectedSid: state.elevationSid }, script,
  }));
  const digest = createHash("sha256").update(data).digest("hex");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "jlj-policy-"));
  const file = path.join(folder, "request.json");
  try {
    fs.writeFileSync(file, data, { flag: "wx" });
    const bootstrap = `${requestScript({ file, digest })}
$ErrorActionPreference = 'Stop'
$bytes = [IO.File]::ReadAllBytes($request.file)
$sha = [Security.Cryptography.SHA256]::Create()
try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') } finally { $sha.Dispose() }
if ($actualHash -ne $request.digest) { throw 'The drive or Chrome policy request changed during elevation.' }
$envelope = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
$request = $envelope.request
& ([ScriptBlock]::Create($envelope.script))`;
    const encoded = Buffer.from(bootstrap, "utf16le").toString("base64");
    const output = await elevate(`"${shell}" ${args.join(" ")} -EncodedCommand ${encoded}`);
    const elevatedState = JSON.parse(output.trim());
    if (elevatedState.elevationSid) throw new Error("Windows did not grant administrator privileges.");
    return elevatedState;
  } finally {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    fs.rmdirSync(folder);
  }
}

module.exports = { runWindowsPolicy };
