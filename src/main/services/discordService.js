const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const { createWriteStream } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");

const installerUrl = "https://discord.com/api/downloads/distributions/app/installers/latest?arch=x64&channel=stable&platform=win";
const installerHosts = new Set(["discord.com", "stable.dl2.discordapp.net", "cdn.discordapp.com", "dl.discordapp.net"]);
const maxInstallerBytes = 300 * 1024 ** 2;
const execFileAsync = promisify(execFile);

async function powershell(script, variables) {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${script}`, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
    env: { ...process.env, ...variables },
    windowsHide: true,
    timeout: 30000,
  });
  return stdout.trim();
}

async function verifyDiscordSignature(file) {
  const result = await powershell(`
    $ErrorActionPreference = 'Stop'
    $signature = Get-AuthenticodeSignature -LiteralPath $env:JLJ_DISCORD_FILE
    if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -match '^Discord Inc[.]?$') {
      'trusted'
    }
  `, { JLJ_DISCORD_FILE: file });
  if (result !== "trusted") throw new Error("Windows could not verify the Discord publisher signature.");
}

async function discordActivity(root) {
  const result = await powershell(`
    $ErrorActionPreference = 'Stop'
    $root = $env:JLJ_DISCORD_ROOT + '\\'
    $session = (Get-Process -Id $PID).SessionId
    $activity = 'idle'
    foreach ($process in (Get-Process | Where-Object { $_.ProcessName -in 'Discord','Update','DiscordSetup' })) {
      if ($process.SessionId -ne $session) { continue }
      if ($process.ProcessName -eq 'DiscordSetup' -or ($process.ProcessName -eq 'Update' -and $process.Path -and $process.Path.StartsWith($root, 'OrdinalIgnoreCase'))) {
        $activity = 'updater'
        break
      }
      if ($process.ProcessName -eq 'Discord') { $activity = 'app' }
    }
    $activity
  `, { JLJ_DISCORD_ROOT: root });
  return result;
}

async function downloadInstaller(file, report, request = globalThis.fetch) {
  const signal = AbortSignal.timeout(180000);
  let url = new URL(installerUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (url.protocol !== "https:" || url.username || url.password || url.port || !installerHosts.has(url.hostname)) {
      throw new Error("Discord redirected the download to an unapproved address.");
    }
    const response = await request(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) break;
      url = new URL(location, url);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`Discord download failed (HTTP ${response.status}).`);
    }
    const total = Number(response.headers.get("content-length"));
    if (total > maxInstallerBytes) {
      await response.body.cancel();
      throw new Error("The Discord download exceeds the size limit.");
    }
    let received = 0;
    let lastPercent = -1;
    const progress = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > maxInstallerBytes) return callback(new Error("The Discord download exceeds the size limit."));
        const percent = total > 0 ? Math.min(100, Math.floor(received * 100 / total)) : null;
        if (percent !== lastPercent) {
          lastPercent = percent;
          report({ phase: "downloading", percent });
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(file, { flags: "wx" }), { signal });
    return;
  }
  throw new Error("Discord did not provide a valid installer download.");
}

async function existsAs(file, predicate) {
  try {
    return (await fs.lstat(file))[predicate]();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return false;
    throw error;
  }
}

async function detectInstallation(root) {
  if (!(await existsAs(root, "isDirectory"))) return null;
  const canonicalRoot = await fs.realpath(root);
  const versions = [];
  for (const entry of await fs.readdir(canonicalRoot, { withFileTypes: true })) {
    const version = /^app-(\d+\.\d+\.\d+)$/.exec(entry.name)?.[1];
    if (entry.isDirectory() && version && await existsAs(path.join(canonicalRoot, entry.name, "Discord.exe"), "isFile")) {
      versions.push(version);
    }
  }
  versions.sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const updater = path.join(canonicalRoot, "Update.exe");
  return {
    version: versions[0] || null,
    executable: versions[0] ? path.join(canonicalRoot, `app-${versions[0]}`, "Discord.exe") : null,
    updater: await existsAs(updater, "isFile") ? updater : null,
  };
}

function runExecutable(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: path.dirname(file), stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Discord exited with code ${code ?? "unknown"}.`));
    });
  });
}

function createDiscordService({
  platform = process.platform,
  arch = process.arch,
  localAppData = process.env.LOCALAPPDATA,
  temp = os.tmpdir(),
  verify = verifyDiscordSignature,
  activity = discordActivity,
  download = downloadInstaller,
  run = runExecutable,
} = {}) {
  const supported = platform === "win32" && arch === "x64" && Boolean(localAppData && path.isAbsolute(localAppData));
  const root = supported ? path.join(localAppData, "Discord") : null;
  let busy = false;

  async function status() {
    const installation = supported ? await detectInstallation(root) : null;
    return {
      supported,
      version: installation?.version ?? null,
      canLaunch: Boolean(installation?.version && installation.updater),
      needsRepair: Boolean(installation && (!installation.version || !installation.updater)),
      updaterRunning: Boolean(installation && (await activity(root)) === "updater"),
    };
  }

  async function exclusive(operation) {
    if (!supported) throw new Error("Discord integration requires Windows x64.");
    if (busy) throw new Error("A Discord operation is already in progress.");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  }

  function launch() {
    return exclusive(async () => {
      const installation = await detectInstallation(root);
      if (!installation?.version || !installation.updater) throw new Error("Discord could not be opened. Try repairing the installation.");
      await verify(installation.updater);
      await verify(installation.executable);
      await run(installation.updater, ["--processStart", "Discord.exe"]);
      return status();
    });
  }

  function install(report) {
    return exclusive(async () => {
      const ensureClosed = async () => {
        if (await activity(root) !== "idle") throw new Error("Discord or its updater is running. Let updates finish, then quit Discord from the system tray and try again.");
      };
      await ensureClosed();
      const directory = await fs.mkdtemp(path.join(temp, "jlj-discord-"));
      try {
        const installer = path.join(directory, "DiscordSetup.exe");
        report({ phase: "downloading", percent: null });
        await download(installer, report);
        report({ phase: "verifying" });
        await verify(installer);
        await ensureClosed();
        report({ phase: "installing" });
        await run(installer, []);
        const result = await status();
        if (!result.canLaunch) throw new Error("Discord setup finished, but JLJ could not find a complete installation. Refresh the status or try repairing.");
        return result;
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(error => console.warn("Could not remove Discord installer files", error));
      }
    });
  }

  return { status, launch, install };
}

module.exports = { createDiscordService, downloadInstaller };
