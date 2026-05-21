const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const { app } = require("electron");

const execAsync = util.promisify(exec);

const QOS_CONFIG = {
  3: { rate: 100000, label: "3 Mbps" },
  4: { rate: 110000, label: "4 Mbps" },
  5: { rate: 120000, label: "5 Mbps" },
};

const POLICY_NAME = "jldems";
const BRAVE_EXE = "brave.exe";

class QosService {
  constructor() {
    this.currentThrottle = null;
    this.elevatorPath = path.join(
      app.getAppPath(),
      "..",
      "elevator",
      "elevator.exe",
    );
  }

  async isAdmin() {
    try {
      await execAsync("net session");
      return true;
    } catch {
      return false;
    }
  }

  buildPowerShell(rate, label) {
    const bps = rate;
    return `
      $ErrorActionPreference = 'SilentlyContinue';
      Remove-NetQosPolicy -Name '${POLICY_NAME}' -PolicyStore ActiveStore -Confirm:$false;
      Remove-NetQosPolicy -Name '${POLICY_NAME}' -PolicyStore PersistentStore -Confirm:$false;
      Get-CimInstance -Namespace 'root/standardcimv2' -ClassName 'MSFT_NetQosPolicySettingData' | 
        Where-Object { $_.Name -eq '${POLICY_NAME}' } | 
        Remove-CimInstance;
      New-NetQosPolicy -Name '${POLICY_NAME}' -AppPathNameMatchCondition '${BRAVE_EXE}' -ThrottleRateActionBitsPerSecond ${bps} -PolicyStore ActiveStore;
      if ($?) { Write-Host 'OK:${label}' } else { exit 1 }
    `
      .replace(/\s+/g, " ")
      .trim();
  }

  buildRemoveScript() {
    return `
      $ErrorActionPreference = 'SilentlyContinue';
      Remove-NetQosPolicy -Name '${POLICY_NAME}' -PolicyStore ActiveStore -Confirm:$false;
      Remove-NetQosPolicy -Name '${POLICY_NAME}' -PolicyStore PersistentStore -Confirm:$false;
      Get-CimInstance -Namespace 'root/standardcimv2' -ClassName 'MSFT_NetQosPolicySettingData' | 
        Where-Object { $_.Name -eq '${POLICY_NAME}' } | 
        Remove-CimInstance;
      Write-Host 'OK:REMOVED'
    `
      .replace(/\s+/g, " ")
      .trim();
  }

  async applyThrottle(mbps) {
    const config = QOS_CONFIG[mbps];
    if (!config) throw new Error(`Invalid throttle: ${mbps} Mbps`);

    const psScript = this.buildPowerShell(config.rate, config.label);

    try {
      // Try direct execution first (if launcher is already admin)
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript}"`,
        { timeout: 15000 },
      );

      if (stdout.includes("OK:")) {
        this.currentThrottle = mbps;
        return { success: true, throttle: mbps };
      }
    } catch (err) {
      // Not admin or failed — fall through to elevation
    }

    // UAC elevation via your elevator or sudo-prompt
    return this.elevateAndRun(psScript, mbps);
  }

  async elevateAndRun(psScript, mbps) {
    const sudo = require("sudo-prompt");

    return new Promise((resolve, reject) => {
      sudo.exec(
        `powershell -NoProfile -Command "${psScript}"`,
        {
          name: "Game Launcher",
          icns: path.join(app.getAppPath(), "..", "assets", "icon.ico"),
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Elevation failed: ${error.message}`));
            return;
          }
          if (stdout?.includes("OK:")) {
            this.currentThrottle = mbps;
            resolve({ success: true, throttle: mbps });
          } else {
            reject(new Error("Policy creation failed"));
          }
        },
      );
    });
  }

  async removeThrottle() {
    const psScript = this.buildRemoveScript();

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript}"`,
        { timeout: 15000 },
      );

      if (stdout.includes("OK:")) {
        this.currentThrottle = null;
        return { success: true, throttle: null };
      }
    } catch {
      // Try elevated
    }

    return this.elevateAndRun(psScript, null);
  }

  async getStatus() {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-NetQosPolicy -Name '${POLICY_NAME}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ThrottleRateActionBitsPerSecond"`,
        { timeout: 5000 },
      );

      const bps = parseInt(stdout.trim(), 10);
      if (isNaN(bps)) return { active: false };

      // Map back to Mbps
      const entry = Object.entries(QOS_CONFIG).find(([, v]) => v.rate === bps);
      return {
        active: true,
        throttle: entry ? parseInt(entry[0]) : Math.round(bps / 1000000),
        exactBps: bps,
      };
    } catch {
      return { active: false };
    }
  }
}

module.exports = new QosService();
