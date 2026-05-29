const { exec, spawn } = require("child_process");
const util = require("util");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
const execAsync = util.promisify(exec);

const sudo = require("sudo-prompt");

class CpService {
  constructor() {
    this.isLocked = false;
  }

  async isAdmin() {
    try {
      await execAsync("net session", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  buildLockScript() {
    return `$ErrorActionPreference = 'Stop'
$key = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'
if (!(Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
Set-ItemProperty -Path $key -Name 'NoControlPanel' -Value 1 -Type DWord -Force
$val = Get-ItemProperty -Path $key -Name 'NoControlPanel' -ErrorAction Stop
if ($val.NoControlPanel -eq 1) { 
  Write-Host 'OK:LOCKED' 
} else { 
  Write-Error 'Failed to set registry value' 
}`;
  }

  buildUnlockScript() {
    return `$ErrorActionPreference = 'Stop'
$key = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'
if (Test-Path $key) {
  Remove-ItemProperty -Path $key -Name 'NoControlPanel' -Force -ErrorAction SilentlyContinue
}
$val = Get-ItemProperty -Path $key -Name 'NoControlPanel' -ErrorAction SilentlyContinue
if ($val.NoControlPanel -eq $null) { 
  Write-Host 'OK:UNLOCKED' 
} else { 
  Write-Error 'Failed to remove registry value' 
}`;
  }

  buildStatusScript() {
    return `$ErrorActionPreference = 'SilentlyContinue'
$key = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'
$val = Get-ItemProperty -Path $key -Name 'NoControlPanel' -ErrorAction SilentlyContinue
if ($val.NoControlPanel -eq 1) { 
  Write-Host 'STATUS:LOCKED' 
} else { 
  Write-Host 'STATUS:UNLOCKED' 
}`;
  }

  // ⭐ ALWAYS use -File with temp script — never inline -Command
  async runScript(psScript) {
    const tmpFile = path.join(os.tmpdir(), `cp_script_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, psScript, "utf8");

    console.log("[CpService] Script written to:", tmpFile);
    console.log("[CpService] Script content:\n", psScript);

    const admin = await this.isAdmin();
    console.log("[CpService] isAdmin:", admin);

    try {
      let result;
      if (admin) {
        // Direct execution with -File
        console.log("[CpService] Running direct (admin)");
        result = await execAsync(
          `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
          { timeout: 15000 },
        );
      } else {
        // Elevation needed
        console.log("[CpService] Running elevated (UAC)");
        result = await this.elevateWithFile(tmpFile);
      }

      console.log("[CpService] stdout:", result.stdout);
      console.log("[CpService] stderr:", result.stderr);

      return result.stdout || result.stderr || "";
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch (e) {
        console.log("[CpService] Failed to clean up temp file:", e.message);
      }
    }
  }

  // Elevation using sudo-prompt with -File
  elevateWithFile(tmpFile) {
    return new Promise((resolve, reject) => {
      const options = {
        name: "Game Launcher",
      };

      const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`;

      console.log("[CpService] sudo-prompt command:", command);

      sudo.exec(command, options, (error, stdout, stderr) => {
        console.log("[CpService] sudo-prompt callback:", {
          error: error?.message,
          stdout,
          stderr,
        });

        if (error) {
          reject(new Error(`Elevation failed: ${error.message}`));
          return;
        }

        resolve({ stdout: stdout || "", stderr: stderr || "" });
      });
    });
  }

  async lockControlPanel() {
    const stdout = await this.runScript(this.buildLockScript());

    if (stdout.includes("OK:LOCKED")) {
      this.isLocked = true;
      return { success: true, locked: true };
    }

    // Check if registry was actually set despite no OK marker
    const check = await this.runScript(this.buildStatusScript());
    if (check.includes("STATUS:LOCKED")) {
      this.isLocked = true;
      return { success: true, locked: true };
    }

    throw new Error("Lock failed. Output: [" + stdout + "]");
  }

  async unlockControlPanel() {
    const stdout = await this.runScript(this.buildUnlockScript());

    if (stdout.includes("OK:UNLOCKED")) {
      this.isLocked = false;
      return { success: true, locked: false };
    }

    // Verify
    const check = await this.runScript(this.buildStatusScript());
    if (check.includes("STATUS:UNLOCKED")) {
      this.isLocked = false;
      return { success: true, locked: false };
    }

    throw new Error("Unlock failed. Output: [" + stdout + "]");
  }

  async getStatus() {
    try {
      const stdout = await this.runScript(this.buildStatusScript());
      const locked = stdout.includes("STATUS:LOCKED");
      this.isLocked = locked;
      return { locked };
    } catch (err) {
      console.error("[CpService] Status error:", err);
      return { locked: false };
    }
  }
}

module.exports = new CpService();
