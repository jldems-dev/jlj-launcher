const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const { app } = require("electron");
const fs = require("fs");

const execAsync = util.promisify(exec);

const QOS_CONFIG = {
  3: { rate: 100000, label: "3 Mbps" },
  4: { rate: 110000, label: "4 Mbps" },
  5: { rate: 120000, label: "5 Mbps" },
};

const POLICY_NAME = "jldems";
const BRAVE_EXE =
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

class QosService {
  constructor() {
    this.currentThrottle = null;
    this.configPath = path.join(app.getPath("userData"), "qos.json");
    this.elevatorPath = path.join(
      app.getAppPath(),
      "..",
      "elevator",
      "elevator.exe",
    );
  }
  saveConfig(mbps) {
    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ throttle: mbps }, null, 2),
      );
    } catch (err) {
      console.error("Failed to save QoS config:", err);
    }
  }

  loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        return null;
      }

      console.log(this.configPath);

      return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
    } catch (err) {
      console.error("Failed to load QoS config:", err);
      return null;
    }
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
        this.saveConfig(mbps);
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
            this.saveConfig(mbps);
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
        this.saveConfig(null);
        return { success: true, throttle: null };
      }
    } catch {
      // Try elevated
    }

    return this.elevateAndRun(psScript, null);
  }

  async restoreThrottle() {
    const config = this.loadConfig();

    if (!config?.throttle) {
      return;
    }

    try {
      console.log("Restoring QoS:", config.throttle);

      await this.applyThrottle(config.throttle);
    } catch (err) {
      console.error("Failed to restore QoS:", err);
    }
  }

  async getStatus() {
    try {
      const config = this.loadConfig();

      if (!config?.throttle) {
        return {
          active: false,
          throttle: null,
        };
      }

      const qos = QOS_CONFIG[config.throttle];

      return {
        active: true,
        throttle: config.throttle,
        exactBps: qos?.rate || null,
        label: qos?.label || null,
      };
    } catch (err) {
      console.error("Failed to get QoS status:", err);

      return {
        active: false,
        throttle: null,
      };
    }
  }
}

module.exports = new QosService();
